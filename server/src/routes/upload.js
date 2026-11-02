import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR } from '../db.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const d = new Date();
    const dir = path.join(UPLOAD_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = ALLOWED[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('不支持的文件类型'));
  },
});

function toUrl(file) {
  const rel = path.relative(UPLOAD_DIR, file.path).split(path.sep).join('/');
  return `/uploads/${rel}`;
}

router.post('/', requireAuth, (req, res) => {
  upload.array('file', 9)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '没有收到文件' });
    res.json({ files: files.map((f) => ({ url: toUrl(f), name: f.originalname, size: f.size })) });
  });
});

export default router;
