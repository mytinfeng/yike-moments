/**
 * 服务端注入网站 TDK。
 *
 * 为什么不在前端改：SPA 的 <title> 是 JS 跑完才变的，
 * Google 能执行 JS 但百度等爬虫通常只抓原始 HTML，
 * 结果就是后台设了 TDK，搜索引擎看到的还是模板里的默认值。
 *
 * 所以这里在返回 index.html 之前，直接把 title / description / keywords
 * 和 Open Graph 标签替换成后台配置的值。模板按 mtime 缓存，
 * 只有重新 build 才会重新读盘，settings 每次实时取，改完刷新就生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from './db.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 属性值转义：description 里出现引号或 < 不至于把 head 撑坏 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** 压成一行并去掉首尾空白：meta 里换行没有意义，还会被截断 */
function oneLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 模板缓存：mtime 变了（重新 build 过）才重新读 */
let cache = { mtimeMs: 0, mtimeNs: 0n, html: '' };

function readTemplate(distDir) {
  const file = path.join(distDir, 'index.html');
  try {
    const stat = fs.statSync(file, { bigint: true });
    if (stat.mtimeNs !== cache.mtimeNs) {
      cache = { mtimeMs: Number(stat.mtimeMs), mtimeNs: stat.mtimeNs, html: fs.readFileSync(file, 'utf8') };
    }
    return cache.html;
  } catch {
    return '';
  }
}

/** 有则替换、无则插入到 </head> 前 */
function upsertMeta(html, name, content) {
  const tag = `<meta name="${name}" content="${esc(content)}">`;
  const re = new RegExp(`<meta\\s+name=["']${name}["'][^>]*>`, 'i');
  if (re.test(html)) return html.replace(re, tag);
  return html.replace(/<\/head>/i, `  ${tag}\n  </head>`);
}

/** 头像可能是站内相对路径，也可能已经是外链，拼成社交平台能抓的绝对地址 */
function absolute(url, origin) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return origin ? `${origin.replace(/\/+$/, '')}${u.startsWith('/') ? '' : '/'}${u}` : u;
}

/**
 * 返回注入了 TDK 的首页 HTML。
 * @param {string} distDir client/dist 目录
 * @param {{ origin?: string, path?: string }} opts origin 用于 og:url / og:image 绝对化
 */
export function renderIndexHtml(distDir, opts = {}) {
  const template = readTemplate(distDir);
  if (!template) return '';

  const s = getSettings();
  const title = oneLine(s.seo_title) || oneLine(s.site_name) || '壹刻';
  const description = oneLine(s.seo_description) || oneLine(s.site_desc);
  const keywords = oneLine(s.seo_keywords);
  const siteName = oneLine(s.site_name) || title;
  const origin = String(opts.origin || '').replace(/\/+$/, '');
  const pageUrl = origin ? `${origin}${opts.path || '/'}` : '';
  const image = absolute(s.avatar, origin);

  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = upsertMeta(html, 'description', description);

  if (keywords) {
    html = upsertMeta(html, 'keywords', keywords);
  } else {
    /* 没填关键词就别留模板里的默认词，免得每个站都背同一串 */
    html = html.replace(/<meta\s+name=["']keywords["'][^>]*>\s*/i, '');
  }

  /* Open Graph：微信 / 微博 / Twitter 分享时抓的是这几项 */
  const og = [
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : '',
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
  ]
    .filter(Boolean)
    .join('\n    ');

  html = html.replace(/<\/head>/i, `    ${og}\n  </head>`);
  return html;
}
