/**
 * 媒体资源管理（仅管理员）
 * - 列表：扫描 uploads 目录，附带「被谁引用」的信息（动态 / 头像 / 封面 / 表情 / 背景音乐）
 * - 删除：只删没被引用的文件；被引用的直接拒绝并说明原因，避免删出破图
 *
 * 上传文件本身没有单独的数据库表（图片地址直接存在动态 / 设置里），
 * 所以这里以磁盘为准，引用关系每次按库里的现有数据实时算。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, getSettings, parseJSON } from '../db.js';
import { requireAdmin } from '../auth.js';

const router = express.Router();
router.use(requireAdmin);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac']);

const ROOT = path.resolve(UPLOAD_DIR);
const MAX_SCAN = 20000; // 兜底：文件多到离谱时不至于把进程拖死

function kindOf(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'other';
}

/** 递归列出 uploads 下的文件（跳过隐藏文件与上传中断残留的 tmp-*） */
function walk(dir, rel = '', out = []) {
  if (out.length >= MAX_SCAN) return out;
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (out.length >= MAX_SCAN) break;
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      walk(abs, r, out);
      continue;
    }
    if (!e.isFile()) continue;
    if (e.name.startsWith('tmp-')) continue;
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    out.push({ rel: r, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

/** url → 引用它的地方。每次请求按库里的现有数据重算，不需要额外维护索引表 */
function buildRefIndex() {
  const map = new Map();
  const add = (url, ref) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    const list = map.get(url);
    if (list) list.push(ref);
    else map.set(url, [ref]);
  };

  for (const u of db.prepare('SELECT id, nickname, avatar FROM users').all()) {
    add(u.avatar, { type: 'user', id: u.id, label: `用户「${u.nickname}」的头像` });
  }

  for (const p of db.prepare('SELECT id, images, video, music, link FROM posts').all()) {
    for (const img of parseJSON(p.images, [])) {
      add(img, { type: 'post', id: p.id, label: `动态 #${p.id} 的图片` });
    }
    add(p.video, { type: 'post', id: p.id, label: `动态 #${p.id} 的视频` });
    const m = parseJSON(p.music, null);
    if (m && typeof m === 'object') {
      add(m.url, { type: 'post', id: p.id, label: `动态 #${p.id} 的背景音乐` });
      add(m.cover, { type: 'post', id: p.id, label: `动态 #${p.id} 的音乐封面` });
    }
    const l = parseJSON(p.link, null);
    if (l && typeof l === 'object') {
      add(l.icon, { type: 'post', id: p.id, label: `动态 #${p.id} 的网页卡片图标` });
    }
  }

  for (const s of db.prepare('SELECT id, name, url FROM stickers').all()) {
    add(s.url, { type: 'sticker', id: s.id, label: `表情包「${s.name || s.id}」` });
  }

  const s = getSettings();
  add(s.avatar, { type: 'setting', key: 'avatar', label: '站点头像' });
  add(s.cover_image, { type: 'setting', key: 'cover_image', label: '封面图' });
  add(s.cover_video, { type: 'setting', key: 'cover_video', label: '封面视频' });
  for (const img of parseJSON(s.cover_images, [])) {
    add(img, { type: 'setting', key: 'cover_images', label: '轮播封面图' });
  }
  for (const t of parseJSON(s.bg_music, [])) {
    if (!t || typeof t !== 'object') continue;
    add(t.url, { type: 'setting', key: 'bg_music', label: '背景音乐' });
    add(t.cover, { type: 'setting', key: 'bg_music', label: '背景音乐封面' });
  }

  return map;
}

/** 绝对路径必须真的落在 uploads 里（防 ../ 逃逸与软链接） */
function safeAbs(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return null;
  const rel = url.replace(/^\/uploads\//, '').replace(/\\/g, '/');
  if (!rel || rel.includes('\0')) return null;
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

/* ============ 列表 ============ */
router.get('/', (req, res) => {
  const type = String(req.query.type || 'all');
  const q = String(req.query.q || '').trim().toLowerCase();
  const used = String(req.query.used || 'all'); // all | used | orphan
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(120, Math.max(12, Number(req.query.pageSize) || 24));

  const refs = buildRefIndex();
  const files = walk(ROOT);

  const stats = { all: 0, image: 0, video: 0, audio: 0, other: 0, orphan: 0, totalSize: 0 };
  const all = files.map((f) => {
    const url = `/uploads/${f.rel}`;
    const kind = kindOf(path.extname(f.rel).toLowerCase());
    const ref = refs.get(url) || [];
    stats.all += 1;
    stats[kind] += 1;
    stats.totalSize += f.size;
    if (!ref.length) stats.orphan += 1;
    return {
      url,
      name: path.basename(f.rel),
      dir: path.dirname(f.rel) === '.' ? '' : path.dirname(f.rel),
      kind,
      size: f.size,
      mtime: new Date(f.mtime).toISOString(),
      refs: ref,
      usedCount: ref.length,
    };
  });

  let list = all;
  if (type !== 'all') list = list.filter((x) => x.kind === type);
  if (used === 'used') list = list.filter((x) => x.usedCount > 0);
  else if (used === 'orphan') list = list.filter((x) => x.usedCount === 0);
  if (q) list = list.filter((x) => x.name.toLowerCase().includes(q) || x.dir.toLowerCase().includes(q));

  list.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));

  const total = list.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, maxPage);
  const items = list.slice((safePage - 1) * pageSize, safePage * pageSize);

  res.json({
    items,
    total,
    page: safePage,
    pageSize,
    maxPage,
    stats,
    root: 'uploads',
    scannedAt: new Date().toISOString(),
  });
});

/* ============ 删除 ============ */
router.delete('/', (req, res) => {
  const body = req.body || {};
  const urls = Array.isArray(body.urls) ? body.urls : [body.url || req.query.url].filter(Boolean);
  if (!urls.length) return res.status(400).json({ error: '没有指定要删除的文件' });
  if (urls.length > 200) return res.status(400).json({ error: '一次最多删除 200 个文件' });

  const refs = buildRefIndex();
  const deleted = [];
  const skipped = [];

  for (const url of urls) {
    const abs = safeAbs(url);
    if (!abs) {
      skipped.push({ url, reason: '路径不合法' });
      continue;
    }
    const ref = refs.get(url) || [];
    if (ref.length) {
      skipped.push({
        url,
        reason: `正在被使用：${ref
          .slice(0, 3)
          .map((r) => r.label)
          .join('、')}${ref.length > 3 ? ` 等 ${ref.length} 处` : ''}`,
      });
      continue;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      skipped.push({ url, reason: '文件不存在' });
      continue;
    }
    if (!st.isFile()) {
      skipped.push({ url, reason: '不是文件' });
      continue;
    }
    try {
      fs.unlinkSync(abs);
      deleted.push(url);
    } catch (e) {
      skipped.push({ url, reason: e.message || '删除失败' });
    }
  }

  res.json({ ok: true, deleted, skipped, count: deleted.length });
});

export default router;
