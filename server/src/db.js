import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = process.env.PYQ_UPLOADS
  ? path.resolve(process.env.PYQ_UPLOADS)
  : path.join(ROOT, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(
  process.env.PYQ_DB ? path.resolve(process.env.PYQ_DB) : path.join(DATA_DIR, 'pyq.db')
);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  website TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT DEFAULT '',
  images TEXT DEFAULT '[]',
  video TEXT DEFAULT '',
  music TEXT DEFAULT '',
  link TEXT DEFAULT '',
  location TEXT DEFAULT '',
  ad_url TEXT DEFAULT '',
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_ad INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL,
  updated_at TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER,
  parent_id INTEGER NOT NULL DEFAULT 0,
  to_user_id INTEGER,
  nickname TEXT NOT NULL,
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  ai_status TEXT NOT NULL DEFAULT 'unchecked',
  ai_reason TEXT DEFAULT '',
  ai_checked_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT DEFAULT '',
  trigger_type TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'running',
  checked INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  message TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  guest_id TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  email TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
`);

/* 兼容旧库：给 likes 补 guest_id（游客点赞用 cookie 标识，user_id 记 0） */
const likeCols = db.prepare('PRAGMA table_info(likes)').all().map((c) => c.name);
if (!likeCols.includes('guest_id')) {
  db.exec("ALTER TABLE likes ADD COLUMN guest_id TEXT NOT NULL DEFAULT ''");
}
/* 兼容旧库：游客点赞时登记过的昵称，留空则前台仍显示「访客」 */
if (!likeCols.includes('nickname')) {
  db.exec("ALTER TABLE likes ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
}

/* 兼容旧库：给 posts 补网页卡片字段（存 {url,title,desc,icon,host} 的 JSON） */
const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
if (!postCols.includes('link')) {
  db.exec("ALTER TABLE posts ADD COLUMN link TEXT DEFAULT ''");
}

/* 兼容旧库：给 comments 补 AI 审核字段（老库升级不丢数据） */
const commentCols = db.prepare('PRAGMA table_info(comments)').all().map((c) => c.name);
for (const [col, ddl] of [
  ['ai_status', "ALTER TABLE comments ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'unchecked'"],
  ['ai_reason', "ALTER TABLE comments ADD COLUMN ai_reason TEXT DEFAULT ''"],
  ['ai_checked_at', "ALTER TABLE comments ADD COLUMN ai_checked_at TEXT DEFAULT ''"],
]) {
  if (!commentCols.includes(col)) db.exec(ddl);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_comments_ai ON comments(ai_status);');

/* 老库的 UNIQUE(post_id, user_id) 会让第二个游客点赞撞车（user_id 都是 0），
   这里把约束换成两个「各自唯一」的部分索引：登录用户按账号唯一，游客按 cookie 唯一 */
const likesSQL =
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'likes'").get()?.sql || '';
if (/UNIQUE\s*\(\s*post_id\s*,\s*user_id\s*\)/i.test(likesSQL)) {
  db.exec(`
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE likes_rebuild (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0,
  guest_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
INSERT INTO likes_rebuild (id, post_id, user_id, guest_id, created_at)
  SELECT id, post_id, COALESCE(user_id, 0), COALESCE(guest_id, ''), created_at FROM likes;
DROP TABLE likes;
ALTER TABLE likes_rebuild RENAME TO likes;
COMMIT;
PRAGMA foreign_keys = ON;
`);
}

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS uq_likes_user ON likes(post_id, user_id) WHERE guest_id = '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_likes_guest ON likes(post_id, guest_id) WHERE guest_id <> '';
CREATE INDEX IF NOT EXISTS idx_likes_guest_id ON likes(guest_id);
`);

/* 表情包：分组 + 表情（只有管理员能加，评论里用 [s:id] 占位符引用） */
db.exec(`
CREATE TABLE IF NOT EXISTS sticker_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (group_id) REFERENCES sticker_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stickers_group ON stickers(group_id, sort, id);
CREATE INDEX IF NOT EXISTS idx_stickers_hash ON stickers(group_id, hash);
CREATE INDEX IF NOT EXISTS idx_stickers_hash_all ON stickers(hash);
`);

/* 登录防爆破：计数表（scope: ip / account / pair）+ 最近尝试日志 */
db.exec(`
CREATE TABLE IF NOT EXISTS login_guard (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_events_time ON login_events(at DESC);
`);

/* ---------------- 工具 ---------------- */
export const now = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function hashPassword(pwd) {
  const salt = crypto.randomBytes(12).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pwd, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- 系统设置 ---------------- */
export const DEFAULT_SETTINGS = {
  site_name: '壹刻',
  site_desc: '最美的时光遇见了你',

  /* ---- 网站 TDK（SEO）----
     seo_title / seo_description 留空时自动回退到「站点名称 / 站点签名」，
     seo_keywords 留空则不输出 keywords 标签。 */
  seo_title: '',
  seo_description: '',
  seo_keywords: '',

  /* ---- 站点对外地址 ----
     反向代理终止 HTTPS 时，Node 看到的是 http://域名:80，
     友站收到的原文链接和图片地址就会是 http，对方 HTTPS 页面会按混合内容拦掉。
     这里留空则自动探测（优先 X-Forwarded-Proto），探测不准时手填 https://域名。 */
  site_origin: '',

  avatar: '/uploads/seed/avatar-main.jpg',
  cover_type: 'image', // image | video | slideshow
  cover_image: '/uploads/seed/cover-1.jpg',
  cover_video: '',
  cover_images: '[]',
  theme_color: '#09c362',
  page_size: '8',
  night_auto: '1',
  allow_register: '1',
  comment_audit: '0',
  footer_text: '©️ 壹刻 · Node + SQLite + Vue',
  bg_music: '[]',
  show_music_player: '1',

  /* ---- AI 评论审核（OpenAI 兼容接口）---- */
  ai_enabled: '0',
  ai_base_url: '',
  ai_api_key: '',
  ai_model: '',
  ai_interval_hours: '3',
  ai_batch_size: '10',
  ai_auto_approve: '1',
  banned_words: '',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value ?? ''));
}

export function setSettings(obj) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (k in DEFAULT_SETTINGS) setSetting(k, v);
  }
}

/* ---------------- JSON 小工具 ---------------- */
export function parseJSON(str, fallback) {
  if (!str) return fallback;
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
