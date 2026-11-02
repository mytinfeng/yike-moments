/**
 * 友站联动（联合订阅）
 *
 * 两个方向，互不依赖：
 *   1. 本站被别人订阅 —— 对外提供 GET /api/federation/feed，凭授权 Key **只读**
 *      最新 20 条动态的摘要；
 *   2. 本站订阅别人 —— 定时拉取各友站的同一接口，结果**只放内存、不落库**，
 *      首页底部渲染成卡片，点击跳回原站。
 *
 * 为什么只给摘要，不给全文：
 *   A 站不需要理解 B 站的排版（表情占位符 [s:12]、网页卡片、轮播、视频），
 *   B 站改版也不会影响 A 站；同时避开了重复内容被搜索引擎判重的问题。
 *
 * 为什么不落库：
 *   内容永远在变，存下来只会陈旧；内存里留着，首页就永远 0 延迟，
 *   对方站点挂了也只是这一块不显示，不影响本站。
 */
import crypto from 'node:crypto';
import { db, getSettings, parseJSON, setSetting } from './db.js';
import { assertPublicUrl } from './link-preview.js';

/** 协议版本：接口字段有破坏性变更时才 +1，A 站据此决定要不要降级 */
export const FED_PROTOCOL = 1;
/** 单个站点最多取多少条 */
export const FRIENDS_MAX = 20;
/** 摘要字数 */
export const EXCERPT_MAX = 140;
/** 多站点合并后最多返回多少条（防止加了 20 个站把首页撑爆） */
const MERGED_MAX = 40;
/** 单站请求超时 */
const FETCH_TIMEOUT = 3000;
/** 响应体读取上限 */
const MAX_BYTES = 512 * 1024;
/** 定时刷新间隔 */
export const REFRESH_EVERY = 10 * 60 * 1000;
/** 最多能加多少个友站 */
const SITES_MAX = 20;

/* ==================== 配置（存 settings 表，不建表） ==================== */

/** 读友站列表；字段做一遍收敛，避免历史脏数据把代码带崩 */
export function readFriends() {
  const raw = parseJSON(getSettings().federation_friends, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f) => f && typeof f === 'object' && f.id && f.url)
    .map((f) => ({
      id: String(f.id),
      url: String(f.url),
      key: String(f.key || ''),
      name: String(f.name || ''),
      enabled: f.enabled !== false,
      added_at: String(f.added_at || ''),
    }))
    .slice(0, SITES_MAX);
}

export function getFedConfig() {
  const s = getSettings();
  return {
    enabled: String(s.federation_enabled || '') === '1',
    key: String(s.federation_key || ''),
    siteOrigin: String(s.site_origin || '').trim(),
    friends: readFriends(),
  };
}

/**
 * 本站对外地址。
 * 线上多一层 nginx / CDN 终止 TLS 时，req.protocol 永远是 http、host 还带着 :80，
 * 拼出来的链接就成了 http://echo.cm:80/post/1 —— 对方 HTTPS 站点会按混合内容拦掉图片。
 * 优先用后台手填的 site_origin；没填就从 X-Forwarded-* 猜，并去掉默认端口。
 */
export function originFromReq(req) {
  const forced = String(getSettings().site_origin || '').trim();
  if (forced) return forced.replace(/\/+$/, '');

  const pick = (v) => String(v || '').split(',')[0].trim();
  const proto = (pick(req.get('x-forwarded-proto')) || req.protocol || 'http').toLowerCase() === 'https'
    ? 'https'
    : 'http';
  let host = pick(req.get('x-forwarded-host')) || req.get('host') || '';
  /* :443 / :80 是协议默认端口，浏览器自己会补，留着反而让链接显得脏 */
  host = host.replace(/:(80|443)$/, '');
  return `${proto}://${host}`;
}

export function setFedEnabled(on) {
  setSetting('federation_enabled', on ? '1' : '0');
}

/** 重置授权 Key：旧 Key 立刻失效，已经用旧 Key 拉取的站点会 403 */
export function resetKey() {
  const k = crypto.randomBytes(24).toString('base64url');
  setSetting('federation_key', k);
  return k;
}

/** 没有 Key 就生成一个，方便后台直接展示和复制 */
export function ensureKey() {
  const c = getFedConfig();
  return c.key || resetKey();
}

export function saveFriends(list) {
  setSetting('federation_friends', JSON.stringify(list.slice(0, SITES_MAX)));
}

/** 定长比较，避免按字符提前返回泄漏 Key 内容 */
export function sameKey(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (!x.length || x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* ==================== 本站对外：生成 feed ==================== */

function absUrl(origin, u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `${origin}${s.startsWith('/') ? '' : '/'}${s}`;
}

/** 正文 → 摘要：去掉表情占位符和裸链接，换行压成空格 */
export function excerptOf(content = '') {
  const t = String(content || '')
    .replace(/\[s:\d{1,9}\]/g, '')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...t].slice(0, EXCERPT_MAX).join('');
}

/**
 * 生成给别的站点看的 feed。
 * 只输出纯数据：站点名 / 头像 / 摘要 / 图片绝对地址 / 原文链接 / 计数。
 * 不输出 ad_url、is_pinned 这些「本站专属」的东西。
 */
export function buildFeed(origin, limit) {
  const n = Math.min(Math.max(Number(limit) || 10, 1), FRIENDS_MAX);
  const s = getSettings();
  const rows = db
    .prepare(
      `SELECT id, content, images, created_at FROM posts
       WHERE status = 'published' AND is_ad = 0
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(n);

  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const group = (sql) =>
    new Map((ids.length ? db.prepare(sql).all(...ids) : []).map((r) => [r.post_id, r.n]));
  const likeMap = group(`SELECT post_id, COUNT(*) n FROM likes WHERE post_id IN (${marks}) GROUP BY post_id`);
  const cmtMap = group(
    `SELECT post_id, COUNT(*) n FROM comments WHERE status = 'approved' AND post_id IN (${marks}) GROUP BY post_id`
  );

  return {
    protocol: FED_PROTOCOL,
    site: {
      name: String(s.site_name || ''),
      url: origin,
      avatar: absUrl(origin, s.avatar),
    },
    items: rows.map((r) => ({
      id: r.id,
      excerpt: excerptOf(r.content),
      images: parseJSON(r.images, [])
        .filter((u) => typeof u === 'string' && u)
        .slice(0, 3)
        .map((u) => absUrl(origin, u)),
      created_at: r.created_at,
      url: `${origin}/post/${r.id}`,
      stats: { likes: likeMap.get(r.id) || 0, comments: cmtMap.get(r.id) || 0 },
    })),
  };
}

/* ==================== 本站订阅别人 ==================== */

const cache = new Map(); // siteId → { ok, site, items, at, error }

function safeText(v, n) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, n);
}

function httpUrl(v) {
  const s = String(v ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

/** 对方返回什么都不可信：字段逐个收敛、截断，图片和链接只认 http(s) */
function normalizeFeed(data) {
  const site = data && typeof data === 'object' && data.site && typeof data.site === 'object' ? data.site : {};
  const list = Array.isArray(data?.items) ? data.items : [];
  const items = [];
  for (const raw of list.slice(0, FRIENDS_MAX)) {
    if (!raw || typeof raw !== 'object') continue;
    const url = httpUrl(raw.url);
    if (!url) continue;
    items.push({
      id: Number(raw.id) || 0,
      excerpt: safeText(raw.excerpt, EXCERPT_MAX + 60),
      images: (Array.isArray(raw.images) ? raw.images : []).map(httpUrl).filter(Boolean).slice(0, 3),
      created_at: safeText(raw.created_at, 30),
      url,
      stats: {
        likes: Math.max(0, Number(raw.stats?.likes) || 0),
        comments: Math.max(0, Number(raw.stats?.comments) || 0),
      },
    });
  }
  return {
    protocol: Number(data?.protocol) || 0,
    site: {
      name: safeText(site.name, 40) || '友站',
      url: httpUrl(site.url),
      avatar: httpUrl(site.avatar),
    },
    items,
  };
}

/** 读响应体，超过上限就截断，避免对方丢个巨大 JSON 把内存吃满 */
async function readCapped(resp, max) {  const reader = resp.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try {
    await reader.cancel();
  } catch {}
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, max);
  return new TextDecoder('utf-8').decode(buf);
}

/**
 * 拉取前的地址校验。
 * 默认走 link-preview 那套（禁止内网 / 回环 / 云元数据地址）；
 * 设了 PYQ_FED_ALLOW_PRIVATE=1 就放开内网限制 —— 只用于本机起两个实例联调，
 * 线上千万别开，否则等于把 SSRF 的口子打开。
 */
async function safeTarget(raw) {
  if (String(process.env.PYQ_FED_ALLOW_PRIVATE || '') === '1') {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 地址');
    return u;
  }
  return assertPublicUrl(raw);
}

/**
 * 把用户填的「对方站点地址」收敛成站点根地址。
 *
 * 最常踩的坑：后台「本站对外」那一块会把完整接口地址
 * https://xxx.com/api/federation/feed 显示出来，用户复制粘贴到「对方站点地址」
 * 里，我们再拼一次 /api/federation/feed，就成了 .../feed/api/federation/feed → 404。
 * 所以这里主动把尾巴上的接口路径剥掉，粘哪种形式都能用。
 */
export function normalizeFriendUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error('请填写对方站点地址');
  /* 先按原样看协议：不先判断就盲目补 https:// 的话，
     ftp://x 会变成 https://ftp//x，看着像合法地址其实是错的 */
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme && !/^https?$/i.test(scheme[1])) throw new Error('只支持 http / https 地址');
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new Error('站点地址格式不对，示例：https://blog.example.com');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 地址');

  u.hash = '';
  u.search = '';
  u.pathname = u.pathname
    .replace(/\/+$/, '')
    /* 完整接口地址、或者接口地址后面还带了 /?limit=20 之类的，都还原成站点根 */
    .replace(/\/api\/federation\/feed(\/.*)?$/i, '');
  return u.toString().replace(/\/+$/, '');
}

/**
 * 拉一次对方的 feed。
 * 手动跟跳转（最多 2 跳），每一跳都重新做内网校验 —— 否则对方一个 302
 * 就能把请求引到 127.0.0.1 上。
 */
export async function probeFeed(baseUrl, key, limit = FRIENDS_MAX) {
  let target = await safeTarget(normalizeFriendUrl(baseUrl));
  const url = new URL(target.toString());
  url.pathname = url.pathname.replace(/\/+$/, '') + '/api/federation/feed';
  url.search = `?limit=${Math.min(Math.max(Number(limit) || FRIENDS_MAX, 1), FRIENDS_MAX)}`;
  target = await safeTarget(url.toString());

  for (let hop = 0; hop < 3; hop++) {
    let resp;
    try {
      resp = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: {
          Accept: 'application/json',
          'X-Federation-Key': String(key || ''),
          'User-Agent': 'YiKe-Federation/1',
        },
      });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error('对方站点响应超时');
      throw new Error('连不上对方站点，检查地址是否可访问');
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) throw new Error('对方返回了无效的跳转');
      target = await safeTarget(new URL(loc, target.toString()).toString());
      continue;
    }
    if (resp.status === 403) throw new Error('授权 Key 不正确，或对方没有开启联合订阅');
    if (resp.status === 404) {
      throw new Error('对方这个地址上没有接口（404），地址只填站点域名即可，比如 https://echo.cm');
    }
    if (!resp.ok) throw new Error(`对方返回 HTTP ${resp.status}`);

    const text = await readCapped(resp, MAX_BYTES);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('对方返回的不是有效 JSON，检查地址是否填成了首页');
    }
    const feed = normalizeFeed(data);
    if (!feed.items.length) throw new Error('对方返回了 0 条内容，可能对方站点还没有公开动态');
    return feed;
  }
  throw new Error('对方跳转次数过多');
}

/** 拉单个友站，成功就整份替换缓存，失败就保留上一次的内容（不让首页突然空掉） */
async function pullFriend(f) {
  try {
    const data = await probeFeed(f.url, f.key);
    cache.set(f.id, { ok: true, site: data.site, items: data.items, at: Date.now(), error: '' });
    return { id: f.id, ok: true, count: data.items.length };
  } catch (e) {
    const prev = cache.get(f.id);
    cache.set(f.id, {
      ok: false,
      site: prev?.site || { name: f.name || '', url: f.url, avatar: '' },
      items: prev?.items || [],
      at: prev?.at || 0,
      error: e?.message || '同步失败',
    });
    return { id: f.id, ok: false, error: e?.message || '同步失败' };
  }
}

export async function refreshFriends() {
  const list = readFriends().filter((f) => f.enabled);
  /* 删掉或停用的站点，缓存一并清掉，别让它们继续出现在首页 */
  const alive = new Set(list.map((f) => f.id));
  for (const id of [...cache.keys()]) if (!alive.has(id)) cache.delete(id);
  return Promise.all(list.map(pullFriend));
}

export async function pullOne(id) {
  const f = readFriends().find((x) => x.id === id);
  if (!f) return null;
  return pullFriend(f);
}

/**
 * 给前台用的合并结果。
 * muted 是访客自己点「不看」屏蔽掉的站点 id 列表。
 */
export function getFriendFeed(muted = []) {
  const friends = readFriends().filter((f) => f.enabled);
  const skip = new Set(muted);
  const sites = [];
  const items = [];

  for (const f of friends) {
    const c = cache.get(f.id);
    /* 站长起的备注优先于对方的站点名：两个友站可能都叫「壹刻」，靠备注才分得清 */
    const label = f.name || c?.site?.name || '友站';
    sites.push({
      id: f.id,
      name: label,
      ok: !!c?.ok,
      error: c?.error || '',
      at: c?.at || 0,
      count: c?.items?.length || 0,
    });
    if (!c || skip.has(f.id)) continue;
    for (const it of c.items) {
      items.push({
        ...it,
        siteId: f.id,
        siteName: label,
        siteAvatar: c.site?.avatar || '',
        siteUrl: c.site?.url || f.url,
      });
    }
  }

  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { sites, items: items.slice(0, MERGED_MAX) };
}

/* ==================== 定时刷新 ==================== */

let timer = null;

export function startFederation() {
  /* 启动先拉一次，但**不 await**：拉不到也不能拖慢服务启动 */
  refreshFriends().catch(() => {});
  timer = setInterval(() => refreshFriends().catch(() => {}), REFRESH_EVERY);
  timer.unref?.();
}
