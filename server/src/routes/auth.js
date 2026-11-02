import express from 'express';
import { db, now, hashPassword, verifyPassword, getSettings } from '../db.js';
import {
  createSession,
  destroySession,
  setTokenCookie,
  clearTokenCookie,
  requireAuth,
  publicUser,
  hitLimit,
} from '../auth.js';
import { clientIp } from '../geo.js';
import {
  loginGate,
  recordFailure,
  recordSuccess,
  failureDelay,
  logEvent,
  scopeLabel,
} from '../security.js';
import { cleanText, checkNickname, checkEmail, checkWebsite, parseBannedWords, countChars } from '../guard.js';

const router = express.Router();

/* 用户不存在时也跑一次同等成本的校验，避免靠响应时间判断账号是否存在 */
const DUMMY_HASH = hashPassword('__pyq_no_such_user__');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function humanWait(sec) {
  if (sec >= 60) {
    const m = Math.ceil(sec / 60);
    return `${m} 分钟`;
  }
  return `${Math.max(1, sec)} 秒`;
}

router.post('/register', (req, res) => {
  const settings = getSettings();
  if (settings.allow_register !== '1') return res.status(403).json({ error: '站点已关闭注册' });
  // 同一 IP 每小时最多注册 5 个，防批量刷号
  if (!hitLimit(`register:ip:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: '注册太频繁了，请稍后再试', retryAfter: 600 });
  }
  const { username = '', email = '', password = '' } = req.body || {};
  const uname = String(username).trim();
  const pwd = String(password);
  if (!/^[\w\u4e00-\u9fa5.-]{2,16}$/.test(uname)) {
    return res.status(400).json({ error: '用户名需为 2-16 个字符' });
  }
  const mailCheck = checkEmail(email, { required: true });
  if (!mailCheck.ok) return res.status(400).json({ error: mailCheck.reason });
  const mail = mailCheck.email;
  const nickCheck = checkNickname(uname, parseBannedWords(getSettings().banned_words));
  if (!nickCheck.ok) return res.status(400).json({ error: `用户名${nickCheck.reason}` });
  if (pwd.length < 6 || pwd.length > 32) return res.status(400).json({ error: '密码需 6-32 位' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) {
    return res.status(409).json({ error: '用户名已被占用' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: '邮箱已被注册' });
  }
  const info = db
    .prepare(
      `INSERT INTO users(username, email, password, nickname, avatar, bio, role, status, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    )
    .run(uname, mail, hashPassword(pwd), uname, '', '', 'user', 'active', now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = createSession(user.id);
  setTokenCookie(res, token);
  res.json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const key = String(username).trim().slice(0, 64);
    const pwd = String(password).slice(0, 200);
    const ua = req.headers['user-agent'] || '';
    const ip = clientIp(req);

    if (!key || !pwd) return res.status(400).json({ error: '请输入账号和密码' });

    // 第一层：同一 IP 的请求洪峰，先挡住再谈验证（比查库 + scrypt 便宜得多）
    if (!hitLimit(`login:ip:${ip}`, 30, 60 * 1000)) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: '请求太频繁了，请稍后再试', retryAfter: 60 });
    }

    // 第二层：是否已被锁定（账号+IP / 账号 / IP 任一命中）
    const gate = loginGate(req, key);
    if (!gate.allowed) {
      logEvent({ ip: gate.ip, username: key, ok: false, reason: `锁定(${scopeLabel(gate.scope)})`, ua });
      res.setHeader('Retry-After', String(gate.retryAfter));
      return res.status(429).json({
        error: `尝试次数过多，请 ${humanWait(gate.retryAfter)}后再试`,
        retryAfter: gate.retryAfter,
      });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(key, key.toLowerCase());

    // 账号不存在也照样算一次 scrypt，响应时间一致
    const passOk = verifyPassword(pwd, user ? user.password : DUMMY_HASH) && !!user;

    if (!passOk) {
      const r = recordFailure(gate.ip, gate.account);
      logEvent({
        ip: gate.ip,
        username: key,
        ok: false,
        reason: r.retryAfter ? '密码错误-已锁定' : '密码错误',
        ua,
      });
      await sleep(failureDelay(r.fails));
      if (r.retryAfter) {
        res.setHeader('Retry-After', String(r.retryAfter));
        return res.status(429).json({
          error: `密码连续错误，请 ${humanWait(r.retryAfter)}后再试`,
          retryAfter: r.retryAfter,
        });
      }
      return res.status(401).json({ error: '账号或密码不正确' });
    }

    if (user.status !== 'active') {
      logEvent({ ip: gate.ip, username: key, ok: false, reason: '账号已禁用', ua });
      return res.status(403).json({ error: '账号已被禁用' });
    }

    recordSuccess(gate.ip, gate.account);
    logEvent({ ip: gate.ip, username: key, ok: true, reason: '登录成功', ua });
    const token = createSession(user.id);
    setTokenCookie(res, token);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('[login]', e);
    if (!res.headersSent) res.status(500).json({ error: '登录失败，请稍后再试' });
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.token);
  clearTokenCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.put('/me', requireAuth, (req, res) => {
  const { nickname, avatar, bio, website, email } = req.body || {};
  const banned = parseBannedWords(getSettings().banned_words);
  const nickCheck =
    nickname !== undefined ? checkNickname(nickname, banned) : { ok: true, name: req.user.nickname };
  if (!nickCheck.ok) return res.status(400).json({ error: nickCheck.reason });
  const nick = nickCheck.name;

  // 邮箱可用于登录，允许自己改；格式校验 + 唯一性检查（排除自己）
  let mail = req.user.email || '';
  if (email !== undefined && String(email).trim() !== '') {
    const mailCheck = checkEmail(email, { required: true });
    if (!mailCheck.ok) return res.status(400).json({ error: mailCheck.reason });
    const dup = db
      .prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?')
      .get(mailCheck.email, req.user.id);
    if (dup) return res.status(400).json({ error: '这个邮箱已经被其他账号使用了' });
    mail = mailCheck.email;
  }

  let site = req.user.website || '';
  if (website !== undefined) {
    const siteCheck = checkWebsite(website);
    if (!siteCheck.ok) return res.status(400).json({ error: siteCheck.reason });
    site = siteCheck.website;
  }

  let intro = req.user.bio || '';
  if (bio !== undefined) {
    intro = cleanText(bio);
    if (countChars(intro) > 100) return res.status(400).json({ error: '简介最多 100 字' });
  }

  db.prepare('UPDATE users SET nickname = ?, avatar = ?, bio = ?, website = ?, email = ? WHERE id = ?').run(
    nick,
    avatar !== undefined ? String(avatar) : req.user.avatar,
    intro,
    site,
    mail,
    req.user.id
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post('/password', requireAuth, (req, res) => {
  // 改密码也要限速，防止盗到 token 后在这里穷举原密码
  if (!hitLimit(`pwd:user:${req.user.id}`, 8, 10 * 60 * 1000)) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: '尝试太频繁，请 10 分钟后再试', retryAfter: 600 });
  }
  const { oldPassword = '', newPassword = '' } = req.body || {};
  if (!verifyPassword(String(oldPassword), req.user.password)) {
    return res.status(400).json({ error: '原密码不正确' });
  }
  if (String(newPassword).length < 6 || String(newPassword).length > 32) {
    return res.status(400).json({ error: '新密码需 6-32 位' });
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

export default router;
