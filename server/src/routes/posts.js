import express from 'express';
import { db, now, getSettings, parseJSON } from '../db.js';
import { requireAuth, likeOwner, hitLimit } from '../auth.js';
import {
  COMMENT_MAX,
  STICKERS_PER_COMMENT_MAX,
  cleanText,
  countCharsNoStickers,
  normalizeStickers,
  detectMalicious,
  checkContent,
  checkNickname,
  checkEmail,
  checkWebsite,
  parseBannedWords,
} from '../guard.js';

const router = express.Router();

const POST_SELECT = `
  SELECT p.*, u.nickname, u.avatar, u.website, u.role AS author_role,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'approved') AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id
`;

/* 点赞名单查询：LEFT JOIN 是因为游客没有账号，user_id 为 0 */
const LIKER_SELECT = `
  SELECT l.post_id, l.user_id, l.nickname AS guest_nickname,
         u.id AS uid, u.nickname AS user_nickname
  FROM likes l LEFT JOIN users u ON u.id = l.user_id
`;

/**
 * 把点赞行整理成前端直接用的名单：
 * - 注册用户：显示账号昵称
 * - 游客登记过昵称：显示登记的昵称（这是他填给自己看的展示名）
 * - 游客没登记：合并成一条「访客 / 访客 ×N」，避免同一行里刷出一堆「访客」
 */
function buildLikers(rows) {
  const list = [];
  let anonymous = 0;
  for (const r of rows) {
    if (r.user_id) {
      list.push({ id: r.user_id, nickname: r.user_nickname || '用户', guest: false });
      continue;
    }
    const nick = String(r.guest_nickname || '').trim();
    if (nick) list.push({ id: 0, nickname: nick, guest: true });
    else anonymous += 1;
  }
  if (anonymous > 0) {
    list.push({ id: 0, nickname: anonymous > 1 ? `访客 ×${anonymous}` : '访客', guest: true });
  }
  return list;
}

function shapeLikers(postId) {
  const rows = db.prepare(`${LIKER_SELECT} WHERE l.post_id = ? ORDER BY l.id ASC`).all(postId);
  return buildLikers(rows);
}

const likeCount = (postId) =>
  db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(postId).n;

function shapePost(row) {
  if (!row) return null;
  return {
    ...row,
    images: parseJSON(row.images, []),
    music: parseJSON(row.music, null),
    link: parseJSON(row.link, null),
    is_pinned: !!row.is_pinned,
    is_ad: !!row.is_ad,
    nsfw: !!row.nsfw,
    like_count: Number(row.like_count || 0),
    comment_count: Number(row.comment_count || 0),
  };
}

/** 网页卡片：只保留必要字段并做长度裁剪，别让前端塞进来一坨东西 */
function normalizeLink(link) {
  if (!link || typeof link !== 'object') return '';
  const url = String(link.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return '';
  const icon = String(link.icon || '').trim();
  return JSON.stringify({
    url: url.slice(0, 500),
    host: cleanText(String(link.host || '')).slice(0, 80),
    title: cleanText(String(link.title || '')).slice(0, 120),
    desc: cleanText(String(link.desc || '')).slice(0, 200),
    icon: /^https?:\/\//i.test(icon) ? icon.slice(0, 500) : '',
  });
}

function commentTree(postId) {
  const rows = db
    .prepare(
      `SELECT c.*, u.avatar AS user_avatar, u.website AS user_website,
              t.nickname AS to_nickname
       FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN comments pc ON pc.id = c.parent_id
       LEFT JOIN users t ON t.id = pc.user_id
       WHERE c.post_id = ? AND c.status = 'approved'
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(postId);

  const byId = new Map();
  const roots = [];
  for (const r of rows) {
    const item = { ...r, replies: [] };
    // 目标昵称：优先取父评论作者昵称（游客评论没有 user_id 时取父评论 nickname）
    if (r.parent_id) {
      const parent = rows.find((x) => x.id === r.parent_id);
      item.to_nickname = parent ? parent.nickname : r.to_nickname || '';
    }
    byId.set(item.id, item);
  }
  for (const r of rows) {
    const item = byId.get(r.id);
    const parent = r.parent_id ? byId.get(r.parent_id) : null;
    if (parent) parent.replies.push(item);
    else roots.push(item);
  }
  return roots;
}

/* 列表 */
router.get('/', (req, res) => {
  const settings = getSettings();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || settings.page_size || '8', 10)));
  const author = req.query.author ? parseInt(req.query.author, 10) : null;
  const month = req.query.month ? String(req.query.month) : '';
  const q = (req.query.q || '').trim();

  const where = [`p.status = 'published'`];
  const args = [];
  if (author) {
    where.push('p.user_id = ?');
    args.push(author);
  }
  if (month) {
    where.push('substr(p.created_at, 1, 7) = ?');
    args.push(month);
  }
  if (q) {
    where.push('(p.content LIKE ? OR u.nickname LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const whereSQL = `WHERE ${where.join(' AND ')}`;

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id ${whereSQL}`)
    .get(...args).n;

  const rows = db
    .prepare(
      `${POST_SELECT} ${whereSQL} ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, pageSize, (page - 1) * pageSize);

  const ids = rows.map((r) => r.id);
  /* 一页动态的点赞一次查完再按 post_id 分组，别在循环里逐条查（N+1） */
  const likeRows = ids.length
    ? db
        .prepare(
          `${LIKER_SELECT} WHERE l.post_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.id ASC`
        )
        .all(...ids)
    : [];
  const likesByPost = new Map();
  for (const row of likeRows) {
    if (!likesByPost.has(row.post_id)) likesByPost.set(row.post_id, []);
    likesByPost.get(row.post_id).push(row);
  }
  // 谁赞过：登录看 user_id，游客看 cookie 里的 guest_id
  const likedByMe = new Set(
    ids.length && (req.user || req.guestId)
      ? db
          .prepare(
            `SELECT post_id FROM likes WHERE ${req.user ? 'user_id = ?' : 'guest_id = ?'} AND post_id IN (${ids
              .map(() => '?')
              .join(',')})`
          )
          .all(req.user ? req.user.id : req.guestId, ...ids)
          .map((r) => r.post_id)
      : []
  );

  const list = rows.map((r) => {
    const p = shapePost(r);
    p.likers = buildLikers(likesByPost.get(r.id) || []);
    p.liked = likedByMe.has(r.id);
    p.comments = commentTree(r.id);
    p.preview = p.comments.length > 3 ? p.comments.slice(0, 3) : p.comments;
    p.hidden_comments = Math.max(0, p.comments.length - p.preview.length);
    return p;
  });

  res.json({
    list,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
});

/* 归档月份 */
router.get('/archives', (req, res) => {
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS count
       FROM posts WHERE status = 'published'
       GROUP BY month ORDER BY month DESC`
    )
    .all();
  res.json(rows);
});

/* 详情 */
router.get('/:id', (req, res) => {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!row || row.status !== 'published') return res.status(404).json({ error: '动态不存在' });
  const post = shapePost(row);
  post.likers = shapeLikers(row.id);
  post.liked = req.user
    ? !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(row.id, req.user.id)
    : req.guestId
      ? !!db
          .prepare('SELECT 1 FROM likes WHERE post_id = ? AND guest_id = ?')
          .get(row.id, req.guestId)
      : false;
  post.comments = commentTree(row.id);
  res.json(post);
});

/* 发布 */
router.post('/', requireAuth, (req, res) => {
  const { content = '', images = [], video = '', music = null, link = null, location = '', ad_url = '' } = req.body || {};
  if (!String(content).trim() && !(Array.isArray(images) && images.length) && !video && !music && !link?.url) {
    return res.status(400).json({ error: '内容不能为空' });
  }
  const isAdmin = req.user.role === 'admin';
  const is_pinned = isAdmin ? (req.body.is_pinned ? 1 : 0) : 0;
  const is_ad = isAdmin ? (req.body.is_ad ? 1 : 0) : 0;
  /* 图片遮罩不跟管理员绑：发布者最清楚自己的图要不要先挡一下 */
  const nsfw = req.body.nsfw ? 1 : 0;
  const info = db
    .prepare(
      `INSERT INTO posts(user_id, content, images, video, music, link, location, ad_url, is_pinned, is_ad, nsfw, status, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      req.user.id,
      String(content),
      JSON.stringify(images || []),
      video || '',
      music ? JSON.stringify(music) : '',
      normalizeLink(link),
      location || '',
      ad_url || '',
      is_pinned,
      is_ad,
      nsfw,
      'published',
      now()
    );
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(info.lastInsertRowid);
  res.json(shapePost(row));
});

/* 修改 */
router.put('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });
  if (post.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权修改' });
  }
  const body = req.body || {};
  const isAdmin = req.user.role === 'admin';
  const next = {
    content: body.content !== undefined ? String(body.content) : post.content,
    images: body.images !== undefined ? JSON.stringify(body.images) : post.images,
    video: body.video !== undefined ? body.video : post.video,
    music:
      body.music !== undefined ? (body.music ? JSON.stringify(body.music) : '') : post.music,
    link: body.link !== undefined ? normalizeLink(body.link) : post.link,
    location: body.location !== undefined ? body.location : post.location,
    ad_url: body.ad_url !== undefined ? body.ad_url : post.ad_url,
    is_pinned: isAdmin && body.is_pinned !== undefined ? (body.is_pinned ? 1 : 0) : post.is_pinned,
    is_ad: isAdmin && body.is_ad !== undefined ? (body.is_ad ? 1 : 0) : post.is_ad,
    nsfw: body.nsfw !== undefined ? (body.nsfw ? 1 : 0) : post.nsfw,
    status: isAdmin && body.status ? body.status : post.status,
  };
  db.prepare(
    `UPDATE posts SET content=?, images=?, video=?, music=?, link=?, location=?, ad_url=?,
     is_pinned=?, is_ad=?, nsfw=?, status=?, updated_at=? WHERE id=?`
  ).run(
    next.content,
    next.images,
    next.video,
    next.music,
    next.link,
    next.location,
    next.ad_url,
    next.is_pinned,
    next.is_ad,
    next.nsfw,
    next.status,
    now(),
    post.id
  );
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(post.id);
  res.json(shapePost(row));
});

/* 删除 */
router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });
  if (post.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权删除' });
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

/* 点赞切换（登录用户按账号，游客按 cookie 标识；带简单限流） */
router.post('/:id/like', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });

  const { userId, guestId } = likeOwner(req);

  if (!req.user) {
    if (!guestId) return res.status(400).json({ error: '浏览器未允许 Cookie，请开启后重试' });
    // 防刷：同一浏览器 1 分钟最多 20 次点赞动作；同一 IP 1 分钟最多 60 次
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!hitLimit(`like-guest:${guestId}`, 20, 60_000) || !hitLimit(`like-ip:${ip}`, 60, 60_000)) {
      return res.status(429).json({ error: '操作太频繁啦，歇一会儿再试' });
    }
  }

  const exists = req.user
    ? db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, userId)
    : db.prepare('SELECT id FROM likes WHERE post_id = ? AND guest_id = ?').get(post.id, guestId);

  /* 游客点赞时捎上登记过的昵称，存下来给别人看；没登记或不合规就留空（仍显示「访客」）。
     昵称只是展示名，校验不过不该阻断点赞。 */
  let guestNick = '';
  if (!req.user) {
    const checked = checkNickname(req.body?.nickname, parseBannedWords(getSettings().banned_words));
    if (checked.ok) guestNick = checked.name;
  }

  if (exists) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(exists.id);
  } else {
    db.prepare(
      'INSERT INTO likes(post_id, user_id, guest_id, nickname, created_at) VALUES(?,?,?,?,?)'
    ).run(post.id, userId, guestId, guestNick, now());
  }

  res.json({ liked: !exists, likers: shapeLikers(post.id), like_count: likeCount(post.id) });
});

/* 评论列表 */
router.get('/:id/comments', (req, res) => {
  res.json(commentTree(req.params.id));
});

/* 发表评论 / 回复 */
router.post('/:id/comments', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });

  const settings = getSettings();
  const banned = parseBannedWords(settings.banned_words);
  const { content = '', parent_id = 0, nickname = '', email = '', website = '' } = req.body || {};

  const raw = String(content ?? '');
  // 表情占位符不占字数：一条评论全是表情时不该被判「超长」
  if (countCharsNoStickers(raw) > COMMENT_MAX) {
    return res.status(400).json({ error: `评论最多 ${COMMENT_MAX} 字` });
  }
  const tokens = raw.match(/\[s:\d{1,9}\]/g) || [];
  if (tokens.length > STICKERS_PER_COMMENT_MAX) {
    return res.status(400).json({ error: `一条评论最多用 ${STICKERS_PER_COMMENT_MAX} 个表情` });
  }
  // 原始输入先查恶意代码（清洗会删掉标签，删完就查不出来了）
  const rawRisk = detectMalicious(raw);
  if (rawRisk) {
    return res.status(400).json({ error: `评论里含有不被允许的${rawRisk}，请修改后再发` });
  }
  // 表情只认「前台可见分组」里的，已删除 / 隐藏的表情占位符直接丢掉
  const validStickers = new Set(
    db
      .prepare(
        'SELECT s.id FROM stickers s JOIN sticker_groups g ON g.id = s.group_id WHERE g.visible = 1'
      )
      .all()
      .map((r) => r.id)
  );
  const sticker = normalizeStickers(cleanText(raw), validStickers);
  const text = sticker.text.replace(/[ \t]{2,}/g, ' ').trim();
  const verdict = checkContent(text, banned);
  if (!verdict.ok) return res.status(400).json({ error: verdict.reason });

  /* 昵称：登录用户用账号昵称，游客走校验 */
  let name;
  if (req.user) {
    name = cleanText(req.user.nickname) || req.user.username;
  } else {
    const nick = checkNickname(nickname, banned);
    if (!nick.ok) return res.status(400).json({ error: nick.reason });
    name = nick.name;
  }

  /* 邮箱：游客必填，登录用户沿用账号邮箱 */
  let mail = '';
  if (req.user) {
    mail = req.user.email || '';
  } else {
    const checked = checkEmail(email, { required: true });
    if (!checked.ok) return res.status(400).json({ error: checked.reason });
    mail = checked.email;
  }

  /* 网站：统一补协议、只允许 http/https */
  let site = '';
  if (req.user) {
    const checked = checkWebsite(req.user.website || '');
    site = checked.website || '';
  } else {
    const checked = checkWebsite(website);
    if (!checked.ok) return res.status(400).json({ error: checked.reason });
    site = checked.website;
  }

  let parent = 0;
  let toUser = null;
  if (parent_id) {
    const parentRow = db.prepare('SELECT * FROM comments WHERE id = ?').get(parent_id);
    if (!parentRow) return res.status(400).json({ error: '回复的评论不存在' });
    parent = parentRow.id;
    toUser = parentRow.user_id || null;
  }

  const status = settings.comment_audit === '1' && !req.user ? 'pending' : 'approved';
  const isAdmin = !!req.user && req.user.role === 'admin';
  const aiStatus = isAdmin ? 'pass' : 'unchecked';
  const aiReason = isAdmin ? '管理员发言，无需审核' : '';

  const info = db
    .prepare(
      `INSERT INTO comments(post_id, user_id, parent_id, to_user_id, nickname, email, website, content,
                            status, ai_status, ai_reason, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      post.id,
      req.user ? req.user.id : null,
      parent,
      toUser,
      name,
      mail,
      site,
      text,
      status,
      aiStatus,
      aiReason,
      now()
    );

  const aiOn = settings.ai_enabled === '1' && settings.ai_auto_approve === '1';
  res.json({
    ok: true,
    status,
    message:
      status === 'pending'
        ? aiOn
          ? '评论已提交，AI 审核通过后会自动显示'
          : '评论已提交，等待审核'
        : '评论成功',
    id: info.lastInsertRowid,
    comments: commentTree(post.id),
  });
});

export default router;
