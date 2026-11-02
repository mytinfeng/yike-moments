/**
 * AI 评论审核（兼容 OpenAI Chat Completions 协议）
 *
 * - 后台配置：接口地址 / API Key / 模型 ID / 间隔小时 / 每批条数
 * - 定时任务：默认每 3 小时跑一次；没有待审内容时直接跳过，不消耗额度
 * - 单批最多 10 条，一次请求审完（省 token，也避免逐条调用）
 * - 判定 reject：评论自动隐藏并记录理由；判定 pass：待审核的游客评论可按设置自动放行
 */
import { db, now, getSettings } from './db.js';
import { cleanText, stripStickers } from './guard.js';

const HARD_MAX_BATCH = 10; // 需求：单批最多 10 条，写死上限
const REQUEST_TIMEOUT = 45_000;
const KEEP_RUNS = 100;

let running = false;
let timer = null;
let lastAutoRun = 0;

/* ---------------- 配置 ---------------- */
export function getAiConfig(settings = getSettings()) {
  const s = settings || {};
  const hours = Math.min(72, Math.max(1, Number(s.ai_interval_hours) || 3));
  const batch = Math.min(HARD_MAX_BATCH, Math.max(1, Number(s.ai_batch_size) || HARD_MAX_BATCH));
  return {
    enabled: s.ai_enabled === '1',
    baseUrl: String(s.ai_base_url || '').trim(),
    apiKey: String(s.ai_api_key || '').trim(),
    model: String(s.ai_model || '').trim(),
    intervalHours: hours,
    batchSize: batch,
    autoApprove: s.ai_auto_approve === '1',
  };
}

export const isAiReady = (cfg) => !!(cfg.enabled && cfg.baseUrl && cfg.apiKey && cfg.model);

/** 把用户填的地址补成 /chat/completions 完整地址 */
export function endpointOf(baseUrl) {
  let u = String(baseUrl || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v\d+[a-z]*$/i.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

/* ---------------- 调用 ---------------- */
async function callChat({ baseUrl, apiKey, model, messages, maxTokens = 1200 }) {
  const url = endpointOf(baseUrl);
  if (!url) throw new Error('未配置 AI 接口地址');
  let res;
  let text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    text = await res.text();
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`AI 接口超时（${REQUEST_TIMEOUT / 1000} 秒无响应）`);
    }
    const code = e?.cause?.code || e?.code || '';
    throw new Error(
      `无法连接 AI 接口${code ? `（${code}）` : ''}，请检查地址与网络：${String(e.message || e).slice(0, 120)}`
    );
  }
  if (!res.ok) {
    const brief = text.replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`AI 接口返回 ${res.status}：${brief || '无响应内容'}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`AI 返回的不是 JSON：${text.slice(0, 200)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回内容为空（可能是模型 ID 不正确）');
  return String(content);
}

/** 从模型回复里抠出 JSON（兼容 ```json 包裹、前后带解释的情况） */
function extractJson(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };
  let v = tryParse(s);
  if (v) return v;
  const start = Math.min(
    ...[s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0).concat([Infinity])
  );
  const endObj = s.lastIndexOf('}');
  const endArr = s.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (Number.isFinite(start) && end > start) {
    v = tryParse(s.slice(start, end + 1));
    if (v) return v;
  }
  return null;
}

const PASS_WORDS = ['pass', 'ok', 'allow', 'approve', 'approved', 'safe', '通过', '正常', '合规'];
const REJECT_WORDS = ['reject', 'block', 'deny', 'spam', 'fail', '违规', '拒绝', '不通过', '垃圾'];

function normalizeVerdict(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (PASS_WORDS.includes(s)) return 'pass';
  if (REJECT_WORDS.includes(s)) return 'reject';
  return '';
}

const SYSTEM_PROMPT = [
  '你是中文社区评论审核员。逐条判断评论是否违规。',
  '违规类别：广告引流、色情低俗、辱骂攻击、违法违规、政治敏感、诈骗欺诈、无意义刷屏。',
  '正常的交流、吐槽、玩梗、表情、技术讨论、提问都算通过；拿不准时判 pass。',
  '只输出 JSON，不要 markdown，不要解释。格式：',
  '{"results":[{"id":1,"verdict":"pass","reason":"正常交流"}]}',
  'verdict 只能是 pass 或 reject；reason 用中文，20 字以内。',
].join('\n');

/* ---------------- 待审队列 ---------------- */
export function pendingCount() {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM comments c
       WHERE c.ai_status = 'unchecked'
         AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT id FROM users WHERE role = 'admin'))`
    )
    .get().n;
}

function takeBatch(limit, ids = null) {
  if (Array.isArray(ids) && ids.length) {
    const marks = ids.map(() => '?').join(',');
    return db
      .prepare(`SELECT id, nickname, content, post_id FROM comments WHERE id IN (${marks})`)
      .all(...ids.map(Number))
      .slice(0, HARD_MAX_BATCH);
  }
  return db
    .prepare(
      `SELECT id, nickname, content, post_id FROM comments c
       WHERE c.ai_status = 'unchecked'
         AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT id FROM users WHERE role = 'admin'))
       ORDER BY c.id ASC LIMIT ?`
    )
    .all(limit);
}

/* ---------------- 单批审核 ---------------- */
async function reviewRows(rows, cfg) {
  const payload = rows.map((r) => ({
    id: r.id,
    // 表情占位符换成人类可读的 [表情]，别让模型把 [s:12] 当成乱码
    content: stripStickers(String(r.content || '')).slice(0, 600),
  }));

  const raw = await callChat({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    maxTokens: 200 + rows.length * 90,
  });

  const parsed = extractJson(raw);
  const list = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(list)) throw new Error('AI 返回格式无法解析（应为 {"results":[...]}）');

  const map = new Map();
  for (const item of list) {
    const id = Number(item?.id);
    if (!Number.isFinite(id)) continue;
    map.set(id, { verdict: normalizeVerdict(item?.verdict), reason: item?.reason });
  }

  const stamp = now();
  const result = { passed: 0, rejected: 0, failed: 0, details: [] };
  const upd = db.prepare(
    'UPDATE comments SET ai_status = ?, ai_reason = ?, ai_checked_at = ? WHERE id = ?'
  );
  const hide = db.prepare(
    "UPDATE comments SET status = 'hidden' WHERE id = ? AND status IN ('approved','pending')"
  );
  const approve = db.prepare("UPDATE comments SET status = 'approved' WHERE id = ? AND status = 'pending'");

  for (const row of rows) {
    const hit = map.get(row.id);
    if (!hit || !hit.verdict) {
      result.failed += 1;
      upd.run('error', 'AI 未返回该条结果，下一轮重试', stamp, row.id);
      result.details.push({ id: row.id, verdict: 'error' });
      continue;
    }
    const reason = cleanText(hit.reason || '').slice(0, 80) ||
      (hit.verdict === 'pass' ? '正常内容' : '命中违规规则');
    upd.run(hit.verdict, reason, stamp, row.id);
    if (hit.verdict === 'reject') {
      hide.run(row.id);
      result.rejected += 1;
    } else {
      if (cfg.autoApprove) approve.run(row.id);
      result.passed += 1;
    }
    result.details.push({ id: row.id, verdict: hit.verdict, reason });
  }
  return result;
}

/* ---------------- 运行一轮 ---------------- */
function logRun(row) {
  const info = db
    .prepare(
      `INSERT INTO ai_runs(started_at, finished_at, trigger_type, status, checked, passed, rejected, failed, message)
       VALUES(?,?,?,?,?,?,?,?,?)`
    )
    .run(
      row.started_at,
      row.finished_at || '',
      row.trigger_type,
      row.status,
      row.checked || 0,
      row.passed || 0,
      row.rejected || 0,
      row.failed || 0,
      row.message || ''
    );
  db.prepare(
    `DELETE FROM ai_runs WHERE id NOT IN (SELECT id FROM ai_runs ORDER BY id DESC LIMIT ${KEEP_RUNS})`
  ).run();
  return info.lastInsertRowid;
}

/**
 * 跑一轮审核：每轮只处理一批，最多 10 条（需求：每次审核最多 10 条）
 * 剩下的留到下一个周期，或者由管理员手动再点一次。
 * @param {'auto'|'manual'} trigger
 * @param {number[]|null} ids 指定评论 id（后台「重新审核」用）
 */
export async function runReviewCycle(trigger = 'auto', ids = null) {
  if (running) return { status: 'busy', message: '上一轮审核还在进行中' };
  const cfg = getAiConfig();
  if (!isAiReady(cfg)) {
    return { status: 'disabled', message: 'AI 审核未开启或配置不完整' };
  }

  running = true;
  const startedAt = now();
  try {
    const total = pendingCount();
    if (!total && !ids) {
      const runId = logRun({
        started_at: startedAt,
        finished_at: now(),
        trigger_type: trigger,
        status: 'skipped',
        message: '没有待审核的评论，本次未调用 AI',
      });
      return { status: 'skipped', message: '没有待审核的评论', runId, remaining: 0 };
    }

    const rows = takeBatch(cfg.batchSize, ids);
    if (!rows.length) {
      return { status: 'skipped', message: '没有待审核的评论', remaining: 0 };
    }

    let checked = 0;
    let passed = 0;
    let rejected = 0;
    let failed = 0;
    const errors = [];

    let res;
    try {
      res = await reviewRows(rows, cfg);
      checked = rows.length;
      passed = res.passed;
      rejected = res.rejected;
      failed = res.failed;
    } catch (e) {
      errors.push(e.message);
      failed = rows.length;
      // 接口失败：这些评论退回待审，下轮重试
      const stamp = now();
      const mark = db.prepare("UPDATE comments SET ai_status = 'unchecked', ai_checked_at = ? WHERE id = ?");
      for (const r of rows) mark.run(stamp, r.id);
    }

    const remaining = pendingCount();
    const runId = logRun({
      started_at: startedAt,
      finished_at: now(),
      trigger_type: trigger,
      status: errors.length ? 'error' : 'done',
      checked,
      passed,
      rejected,
      failed,
      message:
        (errors.length ? `调用失败：${errors[0].slice(0, 160)}` : '') ||
        `审核 ${checked} 条，通过 ${passed} 条，违规 ${rejected} 条` +
          (remaining ? `，还有 ${remaining} 条待审` : ''),
    });
    return {
      status: errors.length ? 'error' : 'done',
      runId,
      checked,
      passed,
      rejected,
      failed,
      remaining,
      errors,
    };
  } finally {
    // 不论成功失败，都从此刻重新计时，避免接口异常时每分钟重试烧额度
    if (trigger === 'auto') lastAutoRun = Date.now();
    running = false;
  }
}

/* ---------------- 连接测试 ---------------- */
export async function testAiConnection({ baseUrl, apiKey, model }) {
  const t0 = Date.now();
  const content = await callChat({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: 'system', content: '你只需要回复两个字：可用' },
      { role: 'user', content: 'ping' },
    ],
    maxTokens: 20,
  });
  return { ok: true, ms: Date.now() - t0, reply: cleanText(content).slice(0, 60) };
}

/* ---------------- 定时器 ---------------- */
function lastAutoRunFromDb() {
  const row = db
    .prepare("SELECT started_at FROM ai_runs WHERE trigger_type = 'auto' ORDER BY id DESC LIMIT 1")
    .get();
  if (!row?.started_at) return 0;
  const t = new Date(String(row.started_at).replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function nextRunAt() {
  const cfg = getAiConfig();
  if (!isAiReady(cfg) || !lastAutoRun) return null;
  return lastAutoRun + cfg.intervalHours * 3600_000;
}

/**
 * 启动调度器：每分钟检查一次，满足「距上次自动审核 ≥ 间隔小时数」才真正跑。
 * 这样后台改间隔能立刻生效，不用重启。
 */
export function startAiScheduler() {
  if (timer) return timer;
  lastAutoRun = lastAutoRunFromDb();
  const tick = async () => {
    try {
      const cfg = getAiConfig();
      if (!isAiReady(cfg) || running) return;
      if (Date.now() - lastAutoRun < cfg.intervalHours * 3600_000) return;
      await runReviewCycle('auto');
    } catch (e) {
      console.error('[ai-review]', e.message);
    }
  };
  timer = setInterval(tick, 60_000);
  timer.unref?.();
  return timer;
}
