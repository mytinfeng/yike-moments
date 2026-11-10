import express from 'express';
import { db, now, hashPassword, getSettings, setSettings, parseJSON, DEFAULT_SETTINGS } from '../db.js';
import { requireAdmin, publicUser } from '../auth.js';
import { cleanText, checkContent, countCharsNoStickers, COMMENT_MAX, parseBannedWords } from '../guard.js';
import { getAiConfig, isAiReady, runReviewCycle, testAiConnection, pendingCount, nextRunAt } from '../ai-review.js';
import { securityOverview, unlock } from '../security.js';

const router = express.Router();
router.use(requireAdmin);

/* ============ 仪表盘 ============ */
router.get('/stats', (req, res) => {
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;
  const today = now().slice(0, 10);
  const stats = {
    posts: one("SELECT COUNT(*) n FROM posts WHERE status='published'"),
    drafts: one("SELECT COUNT(*) n FROM posts WHERE status='draft'"),
    comments: one("SELECT COUNT(*) n FROM comments WHERE status='approved'"),
    pending_comments: one("SELECT COUNT(*) n FROM comments WHERE status='pending'"),
    likes: one('SELECT COUNT(*) n FROM likes'),
    users: one('SELECT COUNT(*) n FROM users'),
    today_posts: one('SELECT COUNT(*) n FROM posts WHERE created_at LIKE ?', `${today}%`),
    today_comments: one('SELECT COUNT(*) n FROM comments WHERE created_at LIKE ?', `${today}%`),
    today_likes: one('SELECT COUNT(*) n FROM likes WHERE created_at LIKE ?', `${today}%`),
    users_today: one('SELECT COUNT(*) n FROM users WHERE created_at LIKE ?', `${today}%`),
    ai_pending: one("SELECT COUNT(*) n FROM comments WHERE ai_status = 'unchecked'"),
    ai_rejected: one("SELECT COUNT(*) n FROM comments WHERE ai_status = 'reject'"),
  };
  const recentPosts = db
    .prepare(
      `SELECT p.id, p.content, p.created_at, p.is_pinned, p.is_ad, u.nickname,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comment_count,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) like_count
       FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 6`
    )
    .all();
  const recentComments = db
    .prepare(
      `SELECT c.id, c.content, c.nickname, c.created_at, c.status, p.id AS post_id
       FROM comments c JOIN posts p ON p.id=c.post_id ORDER BY c.created_at DESC LIMIT 6`
    )
    .all();
  const trend = db
    .prepare(
      `SELECT substr(created_at,1,10) d, COUNT(*) n FROM posts
       WHERE created_at >= date('now','-13 day') GROUP BY d ORDER BY d ASC`
    )
    .all();
  res.json({ stats, recentPosts, recentComments, trend });
});

/* ============ 动态 ============ */
router.get('/posts', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '10', 10)));
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const where = [];
  const args = [];
  if (q) {
    where.push('(p.content LIKE ? OR u.nickname LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push('p.status = ?');
    args.push(status);
  }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db
    .prepare(`SELECT COUNT(*) n FROM posts p JOIN users u ON u.id=p.user_id ${whereSQL}`)
    .get(...args).n;
  const rows = db
    .prepare(
      `SELECT p.*, u.nickname, u.avatar,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) like_count,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comment_count
       FROM posts p JOIN users u ON u.id=p.user_id ${whereSQL}
       ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize);
  res.json({
    list: rows.map((r) => ({
      ...r,
      images: parseJSON(r.images, []),
      music: parseJSON(r.music, null),
      is_pinned: !!r.is_pinned,
      is_ad: !!r.is_ad,
      nsfw: !!r.nsfw,
    })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
});

/* ============ 评论 ============ */
router.get('/comments', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '12', 10)));
  const status = String(req.query.status || '').trim();
  const aiStatus = String(req.query.ai_status || '').trim();
  const q = String(req.query.q || '').trim();
  const where = [];
  const args = [];
  if (status) {
    where.push('c.status = ?');
    args.push(status);
  }
  if (aiStatus) {
    where.push('c.ai_status = ?');
    args.push(aiStatus);
  }
  if (q) {
    where.push('(c.content LIKE ? OR c.nickname LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM comments c ${whereSQL}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT c.*, p.content AS post_content, parent.nickname AS parent_nickname, parent.content AS parent_content
       FROM comments c
       LEFT JOIN posts p ON p.id = c.post_id
       LEFT JOIN comments parent ON parent.id = c.parent_id
       ${whereSQL} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize);
  res.json({ list: rows, total, page, pageSize, hasMore: page * pageSize < total });
});

router.put('/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  const status = String(req.body?.status || '');
  if (!['approved', 'pending', 'hidden'].includes(status)) {
    return res.status(400).json({ error: '状态不合法' });
  }
  db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(status, c.id);
  res.json({ ok: true });
});

router.delete('/comments/:id', (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* 管理员回复 */
router.post('/comments/:id/reply', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  const raw = String(req.body?.content || '');
  if (countCharsNoStickers(raw) > COMMENT_MAX) return res.status(400).json({ error: `回复最多 ${COMMENT_MAX} 字` });
  const content = cleanText(raw);
  const check = checkContent(content, parseBannedWords(getSettings().banned_words));
  if (!check.ok) return res.status(400).json({ error: check.reason });
  const info = db
    .prepare(
      `INSERT INTO comments(post_id, user_id, parent_id, to_user_id, nickname, email, website, content,
                            status, ai_status, ai_reason, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      c.post_id,
      req.user.id,
      c.id,
      c.user_id || null,
      req.user.nickname,
      req.user.email,
      req.user.website,
      content,
      'approved',
      'pass',
      '管理员发言，无需审核',
      now()
    );
  res.json({ ok: true, id: info.lastInsertRowid });
});

/* 重新送审单条评论 */
router.post('/comments/:id/recheck', (req, res) => {
  const c = db.prepare('SELECT id FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  db.prepare("UPDATE comments SET ai_status = 'unchecked', ai_reason = '' WHERE id = ?").run(c.id);
  res.json({ ok: true });
});

/* ============ AI 审核 ============ */
router.get('/ai/status', (req, res) => {
  const cfg = getAiConfig();
  const last = db.prepare('SELECT * FROM ai_runs ORDER BY id DESC LIMIT 1').get() || null;
  const recent = db.prepare('SELECT * FROM ai_runs ORDER BY id DESC LIMIT 6').all();
  const next = nextRunAt();
  res.json({
    configured: isAiReady(cfg),
    enabled: cfg.enabled,
    intervalHours: cfg.intervalHours,
    batchSize: cfg.batchSize,
    autoApprove: cfg.autoApprove,
    pending: pendingCount(),
    total: db.prepare('SELECT COUNT(*) n FROM comments').get().n,
    rejected: db.prepare("SELECT COUNT(*) n FROM comments WHERE ai_status = 'reject'").get().n,
    last,
    recent,
    nextRunAt: next ? new Date(next).toISOString() : null,
  });
});

/* 手动跑一轮（后台「立即审核」） */
router.post('/ai/run', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
    const result = await runReviewCycle('manual', ids);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || '审核执行失败' });
  }
});

/* 测试接口连通性（用表单里未保存的值） */
router.post('/ai/test', async (req, res) => {
  const s = getSettings();
  const baseUrl = String(req.body?.base_url || s.ai_base_url || '').trim();
  const apiKey = String(req.body?.api_key || s.ai_api_key || '').trim();
  const model = String(req.body?.model || s.ai_model || '').trim();
  if (!baseUrl || !apiKey || !model) {
    return res.status(400).json({ error: '请先填写接口地址、API Key 和模型 ID' });
  }
  try {
    const r = await testAiConnection({ baseUrl, apiKey, model });
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: e.message || '连接失败' });
  }
});

/* ============ 用户 ============ */
router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const args = [];
  let whereSQL = '';
  if (q) {
    whereSQL = 'WHERE username LIKE ? OR email LIKE ? OR nickname LIKE ?';
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id) post_count,
        (SELECT COUNT(*) FROM comments c WHERE c.user_id=u.id) comment_count
       FROM users u ${whereSQL} ORDER BY u.id ASC`
    )
    .all(...args);
  res.json(rows.map(publicUserWithStats));
});

function publicUserWithStats(u) {
  return {
    ...publicUser(u),
    post_count: Number(u.post_count || 0),
    comment_count: Number(u.comment_count || 0),
  };
}

router.post('/users', (req, res) => {
  const { username = '', email = '', password = '', nickname = '', avatar = '', bio = '', role = 'user' } =
    req.body || {};
  const uname = String(username).trim();
  const mail = String(email).trim().toLowerCase();
  if (!uname) return res.status(400).json({ error: '用户名不能为空' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname)) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: '邮箱已存在' });
  }
  const info = db
    .prepare(
      `INSERT INTO users(username,email,password,nickname,avatar,bio,role,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    )
    .run(
      uname,
      mail || `${uname}@pyq.local`,
      hashPassword(password),
      String(nickname || uname),
      String(avatar || ''),
      String(bio || ''),
      role === 'admin' ? 'admin' : 'user',
      'active',
      now()
    );
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const b = req.body || {};
  const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'user') : u.role;
  const status = b.status !== undefined ? (b.status === 'banned' ? 'banned' : 'active') : u.status;
  if (u.id === req.user.id && (role !== 'admin' || status !== 'active')) {
    return res.status(400).json({ error: '不能降级或禁用当前登录账号' });
  }
  db.prepare(
    'UPDATE users SET nickname=?, email=?, avatar=?, bio=?, website=?, role=?, status=? WHERE id=?'
  ).run(
    b.nickname !== undefined ? String(b.nickname) : u.nickname,
    b.email !== undefined ? String(b.email).toLowerCase() : u.email,
    b.avatar !== undefined ? String(b.avatar) : u.avatar,
    b.bio !== undefined ? String(b.bio) : u.bio,
    b.website !== undefined ? String(b.website) : u.website,
    role,
    status,
    u.id
  );
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(b.password), u.id);
  }
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)));
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: '不能删除当前登录账号' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ============ 友链 ============ */
router.get('/links', (req, res) => {
  res.json(db.prepare('SELECT * FROM links ORDER BY sort ASC, id ASC').all());
});

router.post('/links', (req, res) => {
  const { name = '', url = '', email = '', sort = 0, visible = 1 } = req.body || {};
  if (!String(name).trim() || !String(url).trim()) {
    return res.status(400).json({ error: '名称和链接不能为空' });
  }
  const info = db
    .prepare('INSERT INTO links(name,url,email,sort,visible) VALUES(?,?,?,?,?)')
    .run(String(name).trim(), String(url).trim(), String(email), Number(sort) || 0, visible ? 1 : 0);
  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/links/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: '友链不存在' });
  const b = req.body || {};
  db.prepare('UPDATE links SET name=?, url=?, email=?, sort=?, visible=? WHERE id=?').run(
    b.name !== undefined ? String(b.name).trim() : l.name,
    b.url !== undefined ? String(b.url).trim() : l.url,
    b.email !== undefined ? String(b.email) : l.email,
    b.sort !== undefined ? Number(b.sort) || 0 : l.sort,
    b.visible !== undefined ? (b.visible ? 1 : 0) : l.visible,
    l.id
  );
  res.json(db.prepare('SELECT * FROM links WHERE id = ?').get(l.id));
});

router.delete('/links/:id', (req, res) => {
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ============ 站点设置 ============ */
router.get('/settings', (req, res) => {
  const s = getSettings();
  res.json({
    ...s,
    cover_images: parseJSON(s.cover_images, []),
    bg_music: parseJSON(s.bg_music, []),
    keys: Object.keys(DEFAULT_SETTINGS),
  });
});

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const payload = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (b[key] === undefined) continue;
    payload[key] = typeof b[key] === 'object' ? JSON.stringify(b[key]) : String(b[key]);
  }
  setSettings(payload);
  res.json({ ok: true, settings: getSettings() });
});

/* ============ 登录安全 ============ */
router.get('/security', (req, res) => {
  res.json(securityOverview());
});

router.post('/security/unlock', (req, res) => {
  const { scope = '', key = '', all = false } = req.body || {};
  if (!all && (!scope || !key)) return res.status(400).json({ error: '缺少要解除的目标' });
  const cleared = unlock(all ? {} : { scope, key });
  res.json({ ok: true, cleared });
});

export default router;
