/**
 * 统一的内容安全层：文本清洗（XSS）、恶意代码识别、昵称 / 邮箱 / 网址规范化
 * 原则：入库存纯文本，渲染端再转义一层，双保险。
 */

export const COMMENT_MAX = 1000;
export const NICKNAME_MAX = 16;
export const EMAIL_MAX = 60;
export const WEBSITE_MAX = 100;
export const MAX_LINKS = 3;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  sol: '/',
  lpar: '(',
  rpar: ')',
};

/** 字符数（按码点算，一个 emoji 算 1 个） */
export const countChars = (str) => [...String(str ?? '')].length;

/* ---------------- 评论里的表情包占位符 ----------------
   评论正文里用 [s:12] 这样的短标记引用表情包（12 = stickers.id），
   渲染时换成图片。占位符不占字数、不参与文本语义。 */
export const STICKERS_PER_COMMENT_MAX = 20;
const STICKER_RE = /\[s:(\d{1,9})\]/g;

/** 去掉表情占位符之后的实际字数：发 100 个表情不该算 600 字 */
export const countCharsNoStickers = (str) => countChars(String(str ?? '').replace(STICKER_RE, ''));

/** 纯文本化：给 AI 审核 / 后台列表用，表情统一显示成 [表情] */
export const stripStickers = (str) => String(str ?? '').replace(/\[s:\d{1,9}\]/g, '[表情]');

/**
 * 收敛表情占位符：只保留真实存在且前台可见的表情，超过上限的丢弃
 * @param {string} text
 * @param {Set<number>} validIds
 */
export function normalizeStickers(text, validIds) {
  let kept = 0;
  let dropped = 0;
  const out = String(text ?? '').replace(/\[s:(\d{1,9})\]/g, (m, id) => {
    const n = Number(id);
    if (kept >= STICKERS_PER_COMMENT_MAX || !validIds?.has(n)) {
      dropped += 1;
      return '';
    }
    kept += 1;
    return `[s:${n}]`;
  });
  return { text: out, kept, dropped };
}

/** HTML 实体解码：把 &#60;script&#62; 这类绕过手法还原成明文，再统一处理 */
function decodeEntities(str) {
  return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const isHex = code[1].toLowerCase() === 'x';
      const n = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) {
        try {
          return String.fromCodePoint(n);
        } catch {
          return m;
        }
      }
      return m;
    }
    const v = ENTITY_MAP[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** 去掉标签（含 script/style 连内容一起删） */
function stripTags(str) {
  let s = str;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(
    /<(script|style|iframe|object|embed|svg|math|template|noscript|frameset|applet)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    ' '
  );
  // 普通标签：< 后面必须紧跟字母 / ! / /，避免误伤 "<3" 这类表情
  s = s.replace(/<\/?[a-z!][^>]*>/gi, ' ');
  return s;
}

/**
 * 文本清洗：实体解码 → 去标签 → 去控制字符 / 零宽字符 → 规范空白
 */
export function cleanText(raw) {
  let s = String(raw ?? '');
  s = decodeEntities(s);
  s = stripTags(s);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(CONTROL_CHARS, '').replace(ZERO_WIDTH, '');
  s = s.replace(/[ \t\u00a0\u3000]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/* ---------------- 恶意代码特征 ---------------- */
const MALICIOUS_RULES = [
  [/<\s*\/?\s*(script|iframe|object|embed|svg|math|link|meta|base|form|input|style)\b/i, 'HTML 标签'],
  [/<\s*\/?\s*[a-z][^>]{0,200}\son[a-z]{3,}\s*=/i, '事件属性'],
  [/\bon[a-z]{3,}\s*=\s*["']?[^"'>\s]{0,40}/i, '事件属性'],
  [/\bjavascript\s*:/i, '脚本协议'],
  [/\bvbscript\s*:/i, '脚本协议'],
  [/\bdata\s*:\s*text\/html/i, '危险协议'],
  [/\bdocument\s*\.\s*(cookie|write|writeln|location|domain)\b/i, '脚本语句'],
  [/\bwindow\s*\.\s*(location|open|eval)\b/i, '脚本语句'],
  [/\beval\s*\(/i, '脚本函数'],
  [/\bnew\s+Function\s*\(/i, '脚本函数'],
  [/<\?php|<\?=|<%[\s\S]{0,80}%>/i, '服务端代码'],
  [/\bunion\s+(all\s+)?select\b/i, 'SQL 注入'],
  [/\bdrop\s+(table|database)\b/i, 'SQL 注入'],
  [/\b(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i, 'SQL 注入'],
  [/\b(xp_cmdshell|information_schema)\b/i, 'SQL 注入'],
];

/** 返回命中的风险类型；没有风险返回空字符串 */
export function detectMalicious(text) {
  const s = String(text ?? '');
  for (const [re, label] of MALICIOUS_RULES) if (re.test(s)) return label;
  return '';
}

/** 屏蔽词（后台可配，逗号 / 换行分隔，不区分大小写） */
export function parseBannedWords(raw) {
  return String(raw ?? '')
    .split(/[,，\n\r、;；|]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 500);
}

/**
 * 评论正文校验（传清洗后的文本）
 * @returns {{ok:boolean, reason?:string}}
 */
export function checkContent(text, bannedWords = []) {
  const s = String(text ?? '');
  if (!s) return { ok: false, reason: '评论内容不能为空' };
  if (countCharsNoStickers(s) > COMMENT_MAX) return { ok: false, reason: `评论最多 ${COMMENT_MAX} 字` };

  const hit = detectMalicious(s);
  if (hit) return { ok: false, reason: `评论里含有不被允许的${hit}，请修改后再发` };

  const links = s.match(/https?:\/\//gi) || [];
  if (links.length > MAX_LINKS) return { ok: false, reason: `评论里最多放 ${MAX_LINKS} 个链接` };

  if (/(.)\1{49,}/u.test(s)) return { ok: false, reason: '请勿重复发送相同字符' };
  if (bannedWords.length) {
    const lower = s.toLowerCase();
    for (const w of bannedWords) {
      if (lower.includes(w.toLowerCase())) return { ok: false, reason: '评论包含敏感词，请修改后再发' };
    }
  }
  return { ok: true };
}

/* ---------------- 昵称 ---------------- */
export function checkNickname(raw, bannedWords = []) {
  const rawStr = String(raw ?? '');
  if (detectMalicious(rawStr)) return { ok: false, reason: '昵称含有不被允许的字符' };
  const name = cleanText(rawStr.replace(/[\r\n\t]/g, ' ')).replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: '请填写昵称' };
  if (countChars(name) > NICKNAME_MAX) return { ok: false, reason: `昵称最多 ${NICKNAME_MAX} 字` };
  if (detectMalicious(name)) return { ok: false, reason: '昵称含有不被允许的字符' };
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)) {
    return { ok: false, reason: '昵称需要包含文字、数字或表情' };
  }
  if (/(.)\1{9,}/u.test(name)) return { ok: false, reason: '昵称请勿重复同一字符' };
  const lower = name.toLowerCase();
  if (bannedWords.some((w) => lower.includes(w.toLowerCase()))) {
    return { ok: false, reason: '昵称包含敏感词，请换一个' };
  }
  return { ok: true, name };
}

/* ---------------- 邮箱 ---------------- */
export function checkEmail(raw, { required = false } = {}) {
  const mail = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!mail) return required ? { ok: false, reason: '请填写邮箱' } : { ok: true, email: '' };
  if (mail.length > EMAIL_MAX) return { ok: false, reason: `邮箱最多 ${EMAIL_MAX} 个字符` };
  if (/[\s<>"'`\\,;]/.test(mail)) return { ok: false, reason: '邮箱格式不正确' };
  const [local = '', domain = ''] = mail.split('@');
  if (!local || !domain || mail.split('@').length !== 2) {
    return { ok: false, reason: '邮箱格式不正确' };
  }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { ok: false, reason: '邮箱格式不正确' };
  }
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(mail)) {
    return { ok: false, reason: '邮箱格式不正确' };
  }
  if (!/\.[a-z]{2,}$/i.test(domain)) return { ok: false, reason: '邮箱域名不完整' };
  return { ok: true, email: mail };
}

/* ---------------- 网站 ---------------- */
export function checkWebsite(raw) {
  let url = cleanText(String(raw ?? '')).replace(/\s+/g, '');
  if (!url) return { ok: true, website: '' };
  if (url.length > WEBSITE_MAX) return { ok: false, reason: `网站地址最多 ${WEBSITE_MAX} 个字符` };
  if (detectMalicious(url)) return { ok: false, reason: '网站地址不合法' };
  if (!/^https?:\/\//i.test(url)) {
    // 带其它协议（javascript:、data:、file: …）直接拒绝
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return { ok: false, reason: '网站地址只支持 http / https' };
    }
    url = `https://${url}`;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: '网站地址格式不正确' };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: '网站地址只支持 http / https' };
  if (parsed.username || parsed.password) return { ok: false, reason: '网站地址不合法' };
  const host = parsed.hostname;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (!isIp && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
    return { ok: false, reason: '网站地址需要一个有效域名' };
  }
  return { ok: true, website: parsed.href };
}
