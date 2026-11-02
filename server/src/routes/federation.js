/**
 * 友站联动的路由
 *   publicRouter → 挂在 /api/federation  （对外提供 feed，凭 Key 只读）
 *   adminRouter  → 挂在 /api/admin/federation（本站的订阅配置）
 */
import express from 'express';
import crypto from 'node:crypto';
import { now, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import {
  buildFeed,
  getFedConfig,
  setFedEnabled,
  resetKey,
  ensureKey,
  sameKey,
  readFriends,
  saveFriends,
  getFriendFeed,
  refreshFriends,
  pullOne,
  probeFeed,
  normalizeFriendUrl,
  originFromReq,
} from '../federation.js';

/* ==================== 对外：给别的站点读 ==================== */

export const publicRouter = express.Router();

/* 轻量限流：Key 对了也防着被反复拉 */
const hits = new Map();
function tooFrequent(ip) {
  const t = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < t) {
    hits.set(ip, { n: 1, reset: t + 60_000 });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  h.n += 1;
  return h.n > 120;
}

publicRouter.get('/feed', (req, res) => {
  const c = getFedConfig();
  if (!c.enabled) return res.status(403).json({ error: '本站没有开启联合订阅' });
  if (!c.key || !sameKey(req.get('x-federation-key'), c.key)) {
    return res.status(403).json({ error: '授权 Key 不正确' });
  }
  if (tooFrequent(req.ip || '')) return res.status(429).json({ error: '请求太频繁' });

  const origin = originFromReq(req);
  /* 不要用 public 缓存：前面挂了 CDN 的话，未带 Key 的请求可能读到缓存副本。
     A 站本来就是自己缓存 10 分钟，这边不需要 HTTP 缓存。 */
  res.setHeader('Cache-Control', 'no-store');
  res.json(buildFeed(origin, req.query.limit));
});

/* ==================== 后台：本站的订阅配置 ==================== */

export const adminRouter = express.Router();
adminRouter.use(requireAdmin);

function sitesStatus() {
  return new Map(getFriendFeed([]).sites.map((s) => [s.id, s]));
}

adminRouter.get('/', (req, res) => {
  const c = getFedConfig();
  const status = sitesStatus();
  /* 手填过就以手填为准；没填就按这次请求的 Host / X-Forwarded-* 现算一个给前端占位 */
  const autoOrigin = originFromReq(req);
  res.json({
    enabled: c.enabled,
    /* 还没有 Key 就顺手生成一个，后台可以直接复制发给别人 */
    key: ensureKey(),
    siteOrigin: c.siteOrigin,
    autoOrigin,
    friends: c.friends.map((f) => {
      const st = status.get(f.id);
      return {
        id: f.id,
        url: f.url,
        name: f.name,
        enabled: f.enabled,
        added_at: f.added_at,
        status: {
          ok: !!st?.ok,
          error: st?.error || '',
          at: st?.at || 0,
          count: st?.count || 0,
          siteName: st?.name || '',
        },
      };
    }),
  });
});

adminRouter.put('/switch', (req, res) => {
  const on = !!req.body?.enabled;
  setFedEnabled(on);
  res.json({ ok: true, enabled: on, key: ensureKey() });
});

adminRouter.post('/key', (req, res) => {
  res.json({ ok: true, key: resetKey() });
});

/** 站点对外地址：留空 = 自动探测（反向代理没传 X-Forwarded-Proto 时，这里手填 https://域名） */
adminRouter.put('/origin', (req, res) => {
  const raw = String(req.body?.origin ?? '').trim();
  if (!raw) {
    setSetting('site_origin', '');
    return res.json({ ok: true, siteOrigin: '', autoOrigin: originFromReq(req) });
  }
  let url;
  try {
    url = normalizeFriendUrl(raw);
  } catch (e) {
    return res.status(400).json({ error: e.message || '地址格式不对' });
  }
  setSetting('site_origin', url);
  res.json({ ok: true, siteOrigin: url });
});

/** 把用户填的地址规整成站点根地址（误填成完整接口地址也能自动纠正，见 normalizeFriendUrl） */
function normalizeBase(raw) {
  return normalizeFriendUrl(raw);
}

adminRouter.post('/preview', async (req, res) => {
  try {
    const url = normalizeBase(req.body?.url);
    const key = String(req.body?.key || '').trim();
    if (!key) throw new Error('请填写对方给你的授权 Key');
    const feed = await probeFeed(url, key, 3);
    res.json({ ok: true, url, key, site: feed.site, items: feed.items });
  } catch (e) {
    res.status(400).json({ error: e.message || '试拉失败' });
  }
});

adminRouter.post('/friends', async (req, res) => {
  try {
    const list = readFriends();
    if (list.length >= 20) throw new Error('最多添加 20 个友站');

    const url = normalizeBase(req.body?.url);
    const key = String(req.body?.key || '').trim();
    if (!key) throw new Error('请填写对方给你的授权 Key');
    if (list.some((f) => f.url === url)) throw new Error('这个站点已经添加过了');

    /* 先拉一次：拉不通就不保存，免得后台堆一堆无效配置 */
    const feed = await probeFeed(url, key, 3);

    const friend = {
      id: crypto.randomBytes(6).toString('hex'),
      url,
      key,
      name: String(req.body?.name || '').trim().slice(0, 40) || feed.site.name || '友站',
      enabled: true,
      added_at: now(),
    };
    list.push(friend);
    saveFriends(list);

    /* 存下来马上整份拉一次，添加完首页就有内容 */
    const pulled = await pullOne(friend.id);
    res.json({ ok: true, friend, pulled });
  } catch (e) {
    res.status(400).json({ error: e.message || '添加失败' });
  }
});

adminRouter.put('/friends/:id', (req, res) => {
  const list = readFriends();
  const i = list.findIndex((f) => f.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '没有这个友站' });
  const b = req.body || {};
  if (b.name !== undefined) list[i].name = String(b.name).trim().slice(0, 40);
  if (b.enabled !== undefined) list[i].enabled = !!b.enabled;
  saveFriends(list);
  if (b.enabled) pullOne(list[i].id).catch(() => {});
  res.json({ ok: true, friend: list[i] });
});

adminRouter.delete('/friends/:id', (req, res) => {
  const list = readFriends();
  const next = list.filter((f) => f.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: '没有这个友站' });
  saveFriends(next);
  /* refreshFriends 会把已经不在列表里的站点缓存清掉 */
  refreshFriends().catch(() => {});
  res.json({ ok: true });
});

adminRouter.post('/refresh', async (req, res) => {
  const results = await refreshFriends();
  res.json({ ok: true, results });
});

adminRouter.post('/friends/:id/refresh', async (req, res) => {
  const r = await pullOne(req.params.id);
  if (!r) return res.status(404).json({ error: '没有这个友站' });
  res.json({ ok: true, result: r });
});
