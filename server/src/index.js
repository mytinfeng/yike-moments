import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachUser, ensureGuest } from './auth.js';
import { ROOT, UPLOAD_DIR, db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { startAiScheduler } from './ai-review.js';
import { renderIndexHtml } from './seo.js';

import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import commentRoutes from './routes/comments.js';
import publicRoutes from './routes/public.js';
import uploadRoutes from './routes/upload.js';
import adminRoutes from './routes/admin.js';
import stickerRoutes from './routes/stickers.js';
import mediaRoutes from './routes/media.js';
import linkRoutes from './routes/link.js';
import { publicRouter as federationPublic, adminRouter as federationAdmin } from './routes/federation.js';
import { startFederation } from './federation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

seedIfEmpty();

const app = express();
app.disable('x-powered-by');
/* 只信任第一层代理（本机 nginx / caddy）。
   不设这个，req.protocol 永远是 http —— 线上 HTTPS 站对外给出的图片和原文链接
   会变成 http://域名:80/...，对方 https 页面会按混合内容拦掉。 */
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);
app.use('/api', ensureGuest);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
/* 上传目录里没有这个文件就老老实实 404，别落到下面的前端路由兜底去返回 HTML */
app.use('/uploads', (req, res) => res.status(404).json({ error: '文件不存在' }));

app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api', publicRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/link', linkRoutes);
app.use('/api/federation', federationPublic);
app.use('/api/admin/stickers', stickerRoutes);
app.use('/api/admin/media', mediaRoutes);
/* 必须排在 /api/admin 之前，否则会被 admin 路由的 requireAdmin 抢先吃掉 */
app.use('/api/admin/federation', federationAdmin);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

/* 前端静态资源：首页 HTML 在返回前注入后台配置的 TDK */
const dist = path.resolve(ROOT, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    /* 带扩展名的路径是静态资源，没命中就老老实实 404，
       别把 /foo.png 也回成一整页 HTML（软 404 对搜索不友好） */
    if (path.extname(req.path)) return next();

    const origin = `${req.protocol}://${req.get('host') || ''}`;
    const html = renderIndexHtml(dist, { origin, path: req.path });
    if (!html) return next();

    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        `<meta charset="utf-8"><div style="font:16px/1.8 system-ui;padding:40px">
         前端尚未构建。请执行 <code>npm run build</code>，或使用 <code>npm run dev</code> 开发模式。<br>
         后台入口：<code>/admin</code>
        </div>`
      );
  });
}

/* 统一错误处理 */
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, () => {
  const count = db.prepare('SELECT COUNT(*) n FROM posts').get().n;
  startAiScheduler();
  startFederation();
  console.log(`\n  朋友圈复刻版已启动`);
  console.log(`  前台  http://localhost:${PORT}/`);
  console.log(`  后台  http://localhost:${PORT}/admin`);
  console.log(`  数据  ${path.join(ROOT, 'data', 'pyq.db')}  动态 ${count} 条\n`);
});
