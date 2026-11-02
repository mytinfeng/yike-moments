/**
 * 网页卡片：抓取目标页面的标题 / 描述 / 图标
 * 只做「取几个 meta 字段」这一件事，所以不上解析库，正则足够；
 * 但对外发请求必须防 SSRF —— 不允许访问内网、回环、云厂商元数据地址。
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT = 8000; // 单跳超时
const MAX_BYTES = 512 * 1024; // 只读前 512KB，避免被超大页面拖死
const MAX_REDIRECTS = 3;
const MAX_LEN = { title: 120, desc: 200 };
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 私有 / 保留地址判断（IPv4 + IPv6） */
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // 含 169.254.169.254 云元数据
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true;
    return false;
  }
  const v = String(ip).toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  if (v.startsWith('::ffff:')) return isPrivateIP(v.slice(7));
  return false;
}

/** 校验 URL 指向公网，返回规整后的 URL（友站联动拉取也复用它防 SSRF） */
export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('网址格式不对');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 链接');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new Error('网址里没有域名');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('不支持抓取内网地址');
  }
  if (net.isIP(host)) {
    if (isPrivateIP(host)) throw new Error('不支持抓取内网地址');
    return u;
  }
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('域名解析失败，检查下网址');
  }
  if (!addrs.length) throw new Error('域名解析失败，检查下网址');
  if (addrs.some((a) => isPrivateIP(a.address))) throw new Error('不支持抓取内网地址');
  return u;
}

/** 读响应体，超过上限就截断（不把整个页面读进内存） */
async function readLimited(resp, max, charset) {
  const reader = resp.body?.getReader();
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
  const enc = /gb2312|gbk|gb18030/i.test(charset) ? 'gbk' : 'utf-8';
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s = '') {
  return String(s)
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把 <meta ...> / <link ...> 拆成属性对象 */
function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

function clip(s, n) {
  const t = decodeEntities(s || '');
  return [...t].slice(0, n).join('');
}

/** 从 HTML 里抠标题、描述、图标 */
function parseMeta(html, baseUrl) {
  const metas = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content) metas[key] = a.content;
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const title = clip(
    metas['og:title'] || metas['twitter:title'] || titleTag,
    MAX_LEN.title
  );
  const desc = clip(
    metas['og:description'] || metas['twitter:description'] || metas.description || '',
    MAX_LEN.desc
  );

  // 图标：优先 apple-touch-icon / 带尺寸的 icon，其次任意 icon，最后试 /favicon.ico
  let icon = '';
  const icons = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel || '').toLowerCase();
    if (!rel.includes('icon') || !a.href) continue;
    icons.push({ href: a.href, apple: rel.includes('apple'), size: Number(String(a.sizes || '').replace(/\D/g, '')) || 0 });
  }
  if (icons.length) {
    icons.sort((x, y) => (y.apple - x.apple) || (y.size - x.size));
    try {
      const u = new URL(icons[0].href, baseUrl);
      if (u.protocol === 'http:' || u.protocol === 'https:') icon = u.href;
    } catch {}
  }

  return { title, desc, icon };
}

/** 探测 /favicon.ico 是否存在（存在才给前端，省得挂一堆破图） */
async function probeFavicon(origin) {
  try {
    const u = await assertPublicUrl(new URL('/favicon.ico', origin).href);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(u, { method: 'GET', signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(timer);
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || '';
    if (type && !/image|icon|octet-stream/i.test(type)) return '';
    try {
      await r.body?.cancel();
    } catch {}
    return u.href;
  } catch {
    return '';
  }
}

export async function fetchLinkPreview(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) throw new Error('请输入网页地址');
  // 明确带了别的协议（file: / javascript: 等）就直接拒，别拼成 https://file://…
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new Error('只支持 http / https 链接');
  }
  const start = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url = start;
  let html = '';
  let finalUrl = '';
  let charset = '';

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let resp;
    try {
      resp = await fetch(u, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? '对方网站响应太慢，稍后再试' : '网页打不开，检查下网址');
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get('location');
      try {
        await resp.body?.cancel();
      } catch {}
      if (!loc) throw new Error('对方网站跳转异常');
      url = new URL(loc, u).href;
      continue;
    }
    if (resp.status === 401 || resp.status === 403) throw new Error('对方网站拒绝访问');
    if (resp.status === 404) throw new Error('网页不存在（404）');
    if (!resp.ok) throw new Error(`对方网站返回 ${resp.status}`);

    const ct = resp.headers.get('content-type') || '';
    if (ct && !/text\/html|application\/xhtml/i.test(ct)) throw new Error('这个链接不是网页');
    finalUrl = u.href;
    charset = ct;
    html = await readLimited(resp, MAX_BYTES, ct);
    break;
  }

  if (!html) throw new Error('没抓到网页内容');

  const { title, desc, icon } = parseMeta(html, finalUrl);
  let finalIcon = icon;
  if (!finalIcon) finalIcon = await probeFavicon(new URL(finalUrl).origin);

  const u = new URL(finalUrl);
  return {
    url: finalUrl,
    host: u.hostname.replace(/^www\./i, ''),
    title: title || u.hostname.replace(/^www\./i, ''),
    desc,
    icon: finalIcon,
  };
}
