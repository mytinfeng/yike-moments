import crypto from 'node:crypto';
import { db, now } from './db.js';

const TOKEN_DAYS = 30;

export function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const created = new Date();
  const expires = new Date(created.getTime() + TOKEN_DAYS * 864e5);
  db.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)').run(
    token,
    userId,
    now(created),
    now(expires)
  );
  return token;
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function readToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers['x-token']) return String(req.headers['x-token']);
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies.pyq_token || '';
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    website: u.website,
    role: u.role,
    status: u.status,
    created_at: u.created_at,
  };
}

export function attachUser(req, res, next) {
  req.token = readToken(req);
  req.user = null;
  if (req.token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > ?`
      )
      .get(req.token, now());
    if (row && row.status === 'active') req.user = row;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

export function setTokenCookie(res, token) {
  const maxAge = TOKEN_DAYS * 86400;
  appendCookie(res, `pyq_token=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`);
}

export function clearTokenCookie(res) {
  appendCookie(res, 'pyq_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
}

/* ---------------- 游客标识（匿名点赞用） ---------------- */
const GUEST_COOKIE = 'pyq_guest';
const GUEST_DAYS = 365;

function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', cookie);
  else res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, cookie] : [prev, cookie]);
}

/** 给没有 pyq_guest 的访客发一个随机 id，一年有效；HttpOnly，前端读不到也改不了 */
export function ensureGuest(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  let gid = cookies[GUEST_COOKIE] || '';
  if (!/^[a-f0-9]{32}$/.test(gid)) {
    gid = crypto.randomBytes(16).toString('hex');
    appendCookie(res, `${GUEST_COOKIE}=${gid}; Path=/; Max-Age=${GUEST_DAYS * 86400}; HttpOnly; SameSite=Lax`);
  }
  req.guestId = gid;
  next();
}

/** 当前访客的点赞身份：登录了就用账号，没登录用 cookie 里的 guestId */
export function likeOwner(req) {
  if (req.user) return { userId: req.user.id, guestId: '' };
  return { userId: 0, guestId: req.guestId || '' };
}

/* ---------------- 简易内存限流（重启清零，够用就行） ---------------- */
const buckets = new Map();

export function hitLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || t > b.reset) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (t > v.reset) buckets.delete(k);
  }
  return b.count <= max;
}
