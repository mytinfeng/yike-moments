import { db, now, hashPassword, setSettings, DEFAULT_SETTINGS, getSettings } from './db.js';
import { fileURLToPath } from 'node:url';

const img = (name) => `/uploads/seed/${name}`;

function d(daysAgo, hour = 9, minute = 26) {
  const t = new Date();
  t.setDate(t.getDate() - daysAgo);
  t.setHours(hour, minute, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(hour)}:${p(minute)}:00`;
}

export function seedIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (userCount > 0) return false;

  console.log('[seed] 初始化演示数据…');

  const insertUser = db.prepare(
    `INSERT INTO users(username,email,password,nickname,avatar,bio,website,role,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  );

  /* 只初始化一个管理员账号：开源分发时不会留一堆可猜密码的演示账号 */
  const admin = insertUser.run(
    'admin',
    'admin@pyq.local',
    hashPassword('admin123456'),
    '壹刻',
    img('avatar-main.jpg'),
    '记录生活的每一帧',
    '',
    'admin',
    'active',
    d(320, 10, 0)
  ).lastInsertRowid;

  const insertPost = db.prepare(
    `INSERT INTO posts(user_id,content,images,video,music,location,ad_url,is_pinned,is_ad,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  );

  /* 只初始化 1 篇动态：留一篇带置顶的介绍，其余内容由站主自己写 */
  const posts = [
    {
      uid: admin,
      content:
        '这款主题以微信朋友圈为设计原型，用时间串联生活，用内容表达情绪。它更像一本公开的生活记录，而不是传统博客——你写的不是文章，是正在发生的日子。\n\n现在它被我搬到了 Node + SQLite + Vue 上，后台可以管动态、评论、用户和站点设置。',
      images: [img('wide.jpg')],
      pinned: 1,
      days: 0,
      hour: 8,
      minute: 30,
    },
  ];

  const postIds = posts.map((p) => {
    return insertPost.run(
      p.uid,
      p.content,
      JSON.stringify(p.images || []),
      p.video || '',
      p.music ? JSON.stringify(p.music) : '',
      p.location || '',
      p.ad || '',
      p.pinned ? 1 : 0,
      p.isAd ? 1 : 0,
      'published',
      d(p.days, p.hour, p.minute)
    ).lastInsertRowid;
  });

  /* 评论 */
  const insertComment = db.prepare(
    `INSERT INTO comments(post_id,user_id,parent_id,to_user_id,nickname,email,website,content,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  );
  const c = (postIdx, uid, nickname, content, days, hour, parent = 0) => {
    const u = uid ? db.prepare('SELECT * FROM users WHERE id = ?').get(uid) : null;
    return insertComment.run(
      postIds[postIdx],
      uid || null,
      parent,
      null,
      nickname,
      u ? u.email : 'guest@example.com',
      u ? u.website : '',
      content,
      'approved',
      d(days, hour, 20)
    ).lastInsertRowid;
  };

  /* 只留 1 条游客评论：能演示游客评论的样式，又不制造一堆假数据 */
  c(0, null, '路过的风', '沙发！顺便问下支持手机端吗？', 0, 13);

  /* 点赞：不预置，真实互动由访客产生 */

  /* 友情链接：不预置，由站主在后台自己加 */

  /* 站点设置 */
  setSettings({
    ...DEFAULT_SETTINGS,
    site_name: '壹刻',
    site_desc: '最美的时光遇见了你',
    avatar: img('avatar-main.jpg'),
    cover_type: 'image',
    cover_image: img('cover-1.jpg'),
    cover_images: JSON.stringify([img('cover-1.jpg'), img('cover-2.jpg'), img('cover-3.jpg')]),
    theme_color: '#09c362',
    page_size: '8',
    night_auto: '1',
    allow_register: '1',
    comment_audit: '0',
    footer_text: '©️ 壹刻 · Node + SQLite + Vue',
    bg_music: JSON.stringify([
      {
        title: 'Night Walk',
        artist: 'SoundHelix',
        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        cover: img('p3.jpg'),
      },
    ]),
    show_music_player: '1',
  });

  console.log('[seed] 完成：1 个管理员 / 1 条动态 / 1 条评论');
  return true;
}

/* 允许直接执行：node src/seed.js */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = seedIfEmpty();
  if (!ok) console.log('数据库已有数据，跳过初始化。如需重置请执行 npm run reset');
  console.log('当前设置：', getSettings().site_name);
}
