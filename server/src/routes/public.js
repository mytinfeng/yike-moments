import express from 'express';
import { db, getSettings, parseJSON } from '../db.js';
import { locate, clientIp } from '../geo.js';
import { checkNickname } from '../guard.js';
import { hitLimit, parseCookies } from '../auth.js';
import { getFriendFeed } from '../federation.js';

const router = express.Router();

/* 按 IP 定位到市级（发布动态时用于默认填充；失败返回空城市，前端继续允许手填） */
router.get('/geo/locate', async (req, res) => {
  const ip = clientIp(req);
  res.setHeader('Cache-Control', 'no-store');
  try {
    const data = await locate(ip);
    res.json(data);
  } catch {
    res.json({ city: '', province: '', country: '', ip, source: '', located: false });
  }
});

/* 公开站点配置 */
router.get('/settings', (req, res) => {
  const s = getSettings();
  res.json({
    site_name: s.site_name,
    site_desc: s.site_desc,
    /* TDK：前台切路由时用它们同步 title / meta */
    seo_title: s.seo_title || '',
    seo_description: s.seo_description || '',
    seo_keywords: s.seo_keywords || '',
    avatar: s.avatar,
    cover_type: s.cover_type,
    cover_image: s.cover_image,
    cover_video: s.cover_video,
    cover_images: parseJSON(s.cover_images, []),
    theme_color: s.theme_color,
    page_size: Number(s.page_size) || 8,
    night_auto: s.night_auto,
    allow_register: s.allow_register,
    comment_audit: s.comment_audit,
    footer_text: s.footer_text,
    bg_music: parseJSON(s.bg_music, []),
    show_music_player: s.show_music_player,
  });
});

/* 信息登记：把昵称回写到这位访客已经点过的赞上。
   不然「登记之前点过的赞」会一直挂成「访客」，得取消再点一次才更新。 */
router.post('/guest/profile', (req, res) => {
  if (req.user) return res.json({ ok: true, updated: 0 });
  if (!req.guestId) return res.status(400).json({ error: '浏览器未允许 Cookie，请开启后重试' });
  if (!hitLimit(`guest-profile:${req.guestId}`, 10, 60_000)) {
    return res.status(429).json({ error: '操作太频繁了，请稍后再试' });
  }
  const checked = checkNickname(req.body?.nickname, []);
  if (!checked.ok) return res.status(400).json({ error: checked.reason });
  const info = db
    .prepare('UPDATE likes SET nickname = ? WHERE guest_id = ? AND user_id = 0')
    .run(checked.name, req.guestId);
  res.json({ ok: true, updated: info.changes });
});

/* 表情包：groups 给评论区选择面板（只含前台可见分组），map 给历史评论渲染。
   map 里包含隐藏分组的表情——分组隐藏只是「不给新评论用」，老评论的表情图照常显示。 */
router.get('/stickers', (req, res) => {
  const groups = db
    .prepare('SELECT id, name FROM sticker_groups WHERE visible = 1 ORDER BY sort ASC, id ASC')
    .all();
  const items = db
    .prepare('SELECT id, group_id, url, name FROM stickers ORDER BY sort ASC, id ASC')
    .all();
  const map = {};
  const names = {};
  for (const s of items) {
    map[s.id] = s.url;
    names[s.id] = s.name || '';
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    groups: groups.map((g) => ({ ...g, stickers: items.filter((s) => s.group_id === g.id) })),
    map,
    names,
  });
});

/* 友情链接 */
router.get('/links', (req, res) => {
  const rows = db
    .prepare('SELECT id, name, url, email FROM links WHERE visible = 1 ORDER BY sort ASC, id ASC')
    .all();
  res.json(rows);
});

/* 友站动态：送信内容全部来自内存缓存（不落库）。
   访客点卡片上的「好友」标签可以「不看」，被屏蔽的站点 id 记在 cookie 里（7 天）。
   服务端也尊重这个 cookie —— 隐藏之后连数据都不再下发，不只是前端不渲染；
   没有 cookie 的爬虫照常拿到内容，不影响收录。 */
router.get('/friends', (req, res) => {
  const muted = String(parseCookies(req.headers.cookie || '').pyq_mute_friends || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const { sites, items } = getFriendFeed(muted);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    hidden: sites.length > 0 && sites.every((s) => muted.includes(s.id)),
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    items,
  });
});

/* 搜索 */
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ list: [] });
  const rows = db
    .prepare(
      `SELECT p.id, p.content, p.images, p.created_at, u.nickname, u.avatar
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.status = 'published' AND (p.content LIKE ? OR u.nickname LIKE ?)
       ORDER BY p.created_at DESC LIMIT 30`
    )
    .all(`%${q}%`, `%${q}%`);
  res.json({
    list: rows.map((r) => ({
      ...r,
      images: parseJSON(r.images, []),
      excerpt: r.content.length > 80 ? `${r.content.slice(0, 80)}…` : r.content,
    })),
  });
});

/* 作者资料 */
router.get('/users/:id', (req, res) => {
  const u = db
    .prepare(
      `SELECT id, nickname, avatar, bio, website, role, created_at FROM users
       WHERE id = ? AND status = 'active'`
    )
    .get(req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const posts = db
    .prepare("SELECT COUNT(*) n FROM posts WHERE user_id = ? AND status = 'published'")
    .get(u.id).n;
  const likes = db
    .prepare('SELECT COUNT(*) n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?')
    .get(u.id).n;
  res.json({ ...u, post_count: posts, like_count: likes });
});

/* 站点总体数据（首页可展示） */
router.get('/overview', (req, res) => {
  const posts = db.prepare("SELECT COUNT(*) n FROM posts WHERE status='published'").get().n;
  const comments = db.prepare("SELECT COUNT(*) n FROM comments WHERE status='approved'").get().n;
  const likes = db.prepare('SELECT COUNT(*) n FROM likes').get().n;
  res.json({ posts, comments, likes });
});

export default router;
