import { store } from './store.js';

export function timeAgo(str) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  const p = (n) => String(n).padStart(2, '0');
  const nowY = new Date().getFullYear();
  if (d.getFullYear() === nowY) return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fullDate(str) {
  if (!str) return '';
  const d = new Date(String(str).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return str;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

export function escapeHTML(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- 表情包 ----------------
   评论正文里的 [s:12] 是表情包占位符（12 = 表情 id），渲染时换成图片。
   表情图地址来自 store.stickerMap（启动时从 /api/stickers 拉取）。 */
export const STICKER_RE = /\[s:(\d{1,9})\]/g;
export const STICKERS_MAX = 20;

/** 占位符转纯文本：后台列表、标题、搜索摘要等只需要文字的地方用 */
export function stickerPlainText(text = '') {
  return String(text || '').replace(/\[s:\d{1,9}\]/g, '[表情]');
}

/** 字数统计：表情占位符不占字数（和后端保持一致） */
export function charCount(text = '') {
  return [...String(text || '').replace(/\[s:\d{1,9}\]/g, '')].length;
}

/** 表情图片 HTML：找不到对应表情（被删了）就不渲染。
 *  alt / title 用后台给的名字（没改过就是文件名），比清一色「表情」更有信息 */
function stickerImg(id) {
  const url = store.stickerMap?.[id];
  if (!url) return '';
  const name = store.stickerNames?.[id] || '';
  const label = escapeHTML(name || '表情');
  return `<img class="c-sticker" src="${escapeHTML(url)}" alt="${label}" title="${label}" loading="lazy" draggable="false">`;
}

/** 文本转 HTML：转义 → 自动链接 → 表情包 → 换行（表情在链接之后插入，避免图片地址被当成链接） */
export function renderText(text = '') {
  const safe = escapeHTML(text);
  const linked = safe.replace(/(https?:\/\/[^\s<]+)/g, (m) => {
    const url = m.replace(/[.,;:!?)]+$/, '');
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link">${url}</a>`;
  });
  return linked.replace(STICKER_RE, (m, id) => stickerImg(id)).replace(/\n/g, '<br>');
}

/** 内容是否需要折叠（超过 5 行左右） */
export function needCollapse(text = '') {
  if (!text) return false;
  const lines = text.split('\n').length;
  return text.length > 130 || lines > 4;
}

export function isVideo(url = '') {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

export function monthLabel(month) {
  if (!month) return '全部';
  const [y, m] = month.split('-');
  return `${y}年${Number(m)}月`;
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * 上传前压缩图片：超过 400KB 的图片等比缩到 1600px 内并转 webp
 * 动图 / SVG / 小图原样返回
 */
export async function compressImage(file, maxSize = 1600, quality = 0.82) {
  const skip = ['image/gif', 'image/svg+xml'];
  if (!file.type?.startsWith('image/') || skip.includes(file.type) || file.size < 400 * 1024) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) return file;
    const name = file.name.replace(/\.\w+$/, '') + '.webp';
    return new File([blob], name, { type: 'image/webp' });
  } catch {
    return file;
  }
}
