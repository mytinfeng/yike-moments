import express from 'express';
import { requireAuth } from '../auth.js';
import { fetchLinkPreview } from '../link-preview.js';

const router = express.Router();

/* 抓取会对外发请求，按账号限流，避免被当成探测工具刷 */
const hits = new Map();
function allow(userId) {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 15) {
    hits.set(userId, arr);
    return false;
  }
  arr.push(now);
  hits.set(userId, arr);
  return true;
}

router.get('/preview', requireAuth, async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: '请输入网页地址' });
  if (url.length > 500) return res.status(400).json({ error: '网址太长了' });
  if (!allow(req.user.id)) return res.status(429).json({ error: '抓取太频繁，稍等一分钟再试' });

  try {
    const data = await fetchLinkPreview(url);
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message || '获取网页信息失败' });
  }
});

export default router;
