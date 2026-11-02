/**
 * 表情包管理（仅管理员）
 * - 分组：增删改、排序、前台显隐
 * - 表情：上传（png / jpg / gif / webp，支持动图）、删除
 * - 文件按内容哈希命名，同一张图重复上传不会产生第二份文件
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, now, UPLOAD_DIR } from '../db.js';
import { requireAdmin } from '../auth.js';
import { cleanText, countChars } from '../guard.js';

const router = express.Router();
router.use(requireAdmin);

export const STICKER_DIR = path.join(UPLOAD_DIR, 'stickers');
fs.mkdirSync(STICKER_DIR, { recursive: true });

/** 启动时清掉上次异常退出残留的临时文件（上传中断会留下 tmp-xxx） */
function sweepTemp() {
  const walk = (dir) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('tmp-')) {
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.unlinkSync(p);
        } catch {}
      }
    }
  };
  walk(STICKER_DIR);
}
sweepTemp();

const MAX_FILE = 4 * 1024 * 1024; // 单个表情 4MB（表情包不会太大，挡一下恶意大文件）
const MAX_FILES = 30;
const GROUP_NAME_MAX = 16;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const d = new Date();
    const dir = path.join(STICKER_DIR, `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, `tmp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE, files: MAX_FILES },
  fileFilter(req, file, cb) {
    if (String(file.mimetype || '').startsWith('image/')) return cb(null, true);
    cb(new Error('只能上传图片文件'));
  },
});

/** 按文件头判断真实类型（防止把 html 改名成 .gif 传上来） */
function sniffImage(buf) {
  if (buf.length < 12) return '';
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) {
    return '.gif';
  }
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return '.png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return '.webp';
  }
  return '';
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** multipart 里的文件名常被按 latin1 解码，中文会变成「ä¸ä¸ª」这种乱码，这里还原回 UTF-8 */
function fixNameEncoding(raw) {
  const s = String(raw || '');
  if (!/[\u0080-\u00ff]/.test(s) || /[\u4e00-\u9fff]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    return fixed.includes('\ufffd') ? s : fixed;
  } catch {
    return s;
  }
}

/** 展示名：去掉扩展名、压掉空白、截短到 16 字（原始文件名往往又长又乱） */
function shortName(original) {
  const base = cleanText(fixNameEncoding(original).replace(/\.[^.]+$/, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return [...base].slice(0, 16).join('') || '表情';
}

function urlOf(absPath) {
  return `/uploads/${path.relative(UPLOAD_DIR, absPath).split(path.sep).join('/')}`;
}

/** 只删 uploads 目录里的文件，且确认没有其它表情还在引用 */
function removeFileIfOrphan(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  if (db.prepare('SELECT 1 FROM stickers WHERE url = ?').get(url)) return;
  const abs = path.resolve(UPLOAD_DIR, url.replace(/^\/uploads\//, ''));
  if (!abs.startsWith(path.resolve(STICKER_DIR))) return;
  try {
    fs.unlinkSync(abs);
  } catch {}
}

function shapeGroup(g) {
  return {
    ...g,
    visible: !!g.visible,
    count: Number(g.count || 0),
  };
}

/* ============ 列表 ============ */
router.get('/', (req, res) => {
  const groups = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM stickers s WHERE s.group_id = g.id) AS count
       FROM sticker_groups g ORDER BY g.sort ASC, g.id ASC`
    )
    .all()
    .map(shapeGroup);
  const stickers = db
    .prepare('SELECT id, group_id, url, name, size, sort, created_at FROM stickers ORDER BY sort ASC, id ASC')
    .all();
  res.json({
    groups: groups.map((g) => ({ ...g, stickers: stickers.filter((s) => s.group_id === g.id) })),
    total: stickers.length,
    maxFileSize: MAX_FILE,
    maxFiles: MAX_FILES,
  });
});

/* ============ 分组 ============ */
router.post('/groups', (req, res) => {
  const name = cleanText(req.body?.name || '').replace(/\s+/g, ' ');
  if (!name) return res.status(400).json({ error: '分组名称不能为空' });
  if (countChars(name) > GROUP_NAME_MAX) {
    return res.status(400).json({ error: `分组名称最多 ${GROUP_NAME_MAX} 字` });
  }
  if (db.prepare('SELECT 1 FROM sticker_groups WHERE name = ?').get(name)) {
    return res.status(409).json({ error: '已经有同名分组了' });
  }
  const sort = Number(req.body?.sort);
  const info = db
    .prepare('INSERT INTO sticker_groups(name, sort, visible, created_at) VALUES(?,?,?,?)')
    .run(
      name,
      Number.isFinite(sort) ? sort : db.prepare('SELECT COUNT(*) n FROM sticker_groups').get().n + 1,
      req.body?.visible === 0 || req.body?.visible === false ? 0 : 1,
      now()
    );
  const g = db.prepare('SELECT * FROM sticker_groups WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ...shapeGroup(g), stickers: [] });
});

router.put('/groups/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM sticker_groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '分组不存在' });
  const b = req.body || {};
  let name = g.name;
  if (b.name !== undefined) {
    name = cleanText(b.name).replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ error: '分组名称不能为空' });
    if (countChars(name) > GROUP_NAME_MAX) {
      return res.status(400).json({ error: `分组名称最多 ${GROUP_NAME_MAX} 字` });
    }
    const dup = db.prepare('SELECT id FROM sticker_groups WHERE name = ? AND id <> ?').get(name, g.id);
    if (dup) return res.status(409).json({ error: '已经有同名分组了' });
  }
  db.prepare('UPDATE sticker_groups SET name = ?, sort = ?, visible = ? WHERE id = ?').run(
    name,
    b.sort !== undefined && Number.isFinite(Number(b.sort)) ? Number(b.sort) : g.sort,
    b.visible !== undefined ? (b.visible ? 1 : 0) : g.visible,
    g.id
  );
  const out = db.prepare('SELECT * FROM sticker_groups WHERE id = ?').get(g.id);
  res.json(
    shapeGroup({
      ...out,
      count: db.prepare('SELECT COUNT(*) n FROM stickers WHERE group_id = ?').get(g.id).n,
    })
  );
});

router.delete('/groups/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM sticker_groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: '分组不存在' });
  const urls = db.prepare('SELECT url FROM stickers WHERE group_id = ?').all(g.id).map((r) => r.url);
  db.prepare('DELETE FROM stickers WHERE group_id = ?').run(g.id);
  db.prepare('DELETE FROM sticker_groups WHERE id = ?').run(g.id);
  for (const u of urls) removeFileIfOrphan(u);
  res.json({ ok: true, removed: urls.length });
});

/* ============ 上传表情 ============ */
router.post('/upload', (req, res) => {
  const groupId = Number(req.query.group_id || req.body?.group_id);
  const group = db.prepare('SELECT * FROM sticker_groups WHERE id = ?').get(groupId);
  if (!group) return res.status(400).json({ error: '分组不存在，请先选择或创建分组' });

  upload.array('files', MAX_FILES)(req, res, (err) => {
    const files = req.files || [];
    if (err) {
      for (const f of files) {
        try {
          fs.unlinkSync(f.path);
        } catch {}
      }
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? `单个表情不能超过 ${Math.round(MAX_FILE / 1024 / 1024)}MB`
          : err.code === 'LIMIT_FILE_COUNT'
            ? `一次最多上传 ${MAX_FILES} 张`
            : err.message || '上传失败';
      return res.status(400).json({ error: msg });
    }
    if (!files.length) return res.status(400).json({ error: '没有收到文件' });

    const added = [];
    const skipped = [];
    const failed = [];
    const findByHash = db.prepare('SELECT id, url, group_id FROM stickers WHERE hash = ? LIMIT 1');
    const sortBase = db.prepare('SELECT COUNT(*) n FROM stickers WHERE group_id = ?').get(group.id).n;
    const insert = db.prepare(
      'INSERT INTO stickers(group_id, url, name, hash, size, sort, created_at) VALUES(?,?,?,?,?,?,?)'
    );
    const setUrl = db.prepare('UPDATE stickers SET url = ? WHERE id = ?');
    const dropRow = db.prepare('DELETE FROM stickers WHERE id = ?');

    files.forEach((f, i) => {
      const original = String(f.originalname || '表情');
      const name = shortName(original);
      try {
        if (f.size > MAX_FILE) throw new Error('文件太大');
        const head = fs.readFileSync(f.path).subarray(0, 16);
        const ext = sniffImage(head);
        if (!ext) throw new Error('不是有效的图片文件');
        const hash = sha256(f.path);

        const hit = findByHash.get(hash);
        if (hit) {
          fs.unlinkSync(f.path);
          if (hit.group_id === group.id) {
            skipped.push({ name, id: hit.id });
            return;
          }
          // 同一张图已经在别的分组里：文件直接复用，不重复写盘
          const info = insert.run(group.id, hit.url, name, hash, f.size, sortBase + i, now());
          added.push({ id: Number(info.lastInsertRowid), group_id: group.id, url: hit.url, name });
          return;
        }

        // 先用自增 id 占位，再按 id 落盘成短文件名（stk-12.gif），不再用一长串哈希
        const info = insert.run(group.id, '', name, hash, f.size, sortBase + i, now());
        const id = Number(info.lastInsertRowid);
        let abs;
        try {
          const dir = path.dirname(f.path);
          abs = path.join(dir, `stk-${id}${ext}`);
          // 极少数情况（旧文件残留 / 手工拷贝）会撞名，追加两位随机就好
          if (fs.existsSync(abs)) {
            abs = path.join(dir, `stk-${id}-${crypto.randomBytes(2).toString('hex')}${ext}`);
          }
          fs.renameSync(f.path, abs);
        } catch (e) {
          dropRow.run(id); // 落盘失败就别留一条空 url 的脏记录
          throw e;
        }

        const url = urlOf(abs);
        setUrl.run(url, id);
        added.push({ id, group_id: group.id, url, name });
      } catch (e) {
        try {
          fs.unlinkSync(f.path);
        } catch {}
        failed.push({ name, reason: e.message || '处理失败' });
      }
    });

    res.json({ ok: true, added, skipped, failed, count: added.length });
  });
});

/* ============ 改名（上传后自定义名称，前台作为 alt / 悬停提示） ============ */
const STICKER_NAME_MAX = 20;
router.put('/items/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '表情不存在' });
  const raw = cleanText(req.body?.name ?? '').replace(/\s+/g, ' ');
  if (!raw) return res.status(400).json({ error: '名称不能为空' });
  if (countChars(raw) > STICKER_NAME_MAX) {
    return res.status(400).json({ error: `名称最多 ${STICKER_NAME_MAX} 字` });
  }
  db.prepare('UPDATE stickers SET name = ? WHERE id = ?').run(raw, s.id);
  res.json({ ok: true, id: s.id, name: raw });
});

/* ============ 删除表情 ============ */
router.delete('/items/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM stickers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: '表情不存在' });
  db.prepare('DELETE FROM stickers WHERE id = ?').run(s.id);
  removeFileIfOrphan(s.url);
  res.json({ ok: true });
});

export default router;
