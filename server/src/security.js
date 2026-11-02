/**
 * 登录防爆破
 *
 * 三层计数，任一层超限就锁定一段时间（锁定期间连密码都不校验，省得被拖慢）：
 *   pair    账号 + IP   5 次失败 / 15 分钟 → 锁 10 分钟（主要防线，打一个账号换着密码试）
 *   account 账号        10 次失败 / 15 分钟 → 锁 5 分钟（防换 IP 的分布式撞库，故意锁得短，避免恶意把人锁死）
 *   ip      IP          20 次失败 / 15 分钟 → 锁 15 分钟（防同一来源横扫所有账号）
 *
 * 锁定时长随连续超限次数翻倍，最长 1 小时。计数落库（重启不清零），成功后清掉 pair / account 两层的计数。
 */
import { db, now } from './db.js';
import { clientIp } from './geo.js';

const WINDOW = 15 * 60 * 1000;
const MAX_LOCK = 60 * 60 * 1000;

export const GUARD_RULES = {
  pair: { label: '账号 + IP', max: 5, lock: 10 * 60 * 1000 },
  account: { label: '账号', max: 10, lock: 5 * 60 * 1000 },
  ip: { label: 'IP', max: 20, lock: 15 * 60 * 1000 },
};

const LIMIT_USERNAME = 64;

export function accountKey(name) {
  return String(name || '').trim().toLowerCase().slice(0, LIMIT_USERNAME);
}

export function scopeLabel(scope) {
  return GUARD_RULES[scope]?.label || scope;
}

function row(scope, key) {
  if (!key) return null;
  return db.prepare('SELECT * FROM login_guard WHERE scope = ? AND key = ?').get(scope, key);
}

function bump(scope, key, rule, t) {
  if (!key) return { fails: 0, lockedUntil: 0 };
  const prev = row(scope, key);
  let fails = 1;
  let first = t;
  if (prev) {
    if (t - prev.last_at > WINDOW) {
      fails = 1;
      first = t;
    } else {
      fails = prev.fails + 1;
      first = prev.first_at || t;
    }
  }
  let lockedUntil = 0;
  if (fails >= rule.max) {
    const times = Math.floor(fails / rule.max);
    const dur = Math.min(MAX_LOCK, rule.lock * Math.max(1, times));
    lockedUntil = t + dur;
  }
  db.prepare(
    `INSERT INTO login_guard(scope, key, fails, first_at, last_at, locked_until) VALUES(?,?,?,?,?,?)
     ON CONFLICT(scope, key) DO UPDATE SET
       fails = excluded.fails, first_at = excluded.first_at,
       last_at = excluded.last_at, locked_until = excluded.locked_until`
  ).run(scope, key, fails, first, t, lockedUntil);
  return { fails, lockedUntil };
}

/**
 * 登录前置检查：锁定中直接拒绝。
 * 返回 { allowed, ip, account, retryAfter, scope }
 */
export function loginGate(req, username) {
  const ip = clientIp(req);
  const account = accountKey(username);
  const t = Date.now();
  const checks = [
    ['ip', ip],
    ['pair', `${ip}|${account}`],
    ['account', account],
  ];
  for (const [scope, key] of checks) {
    const r = row(scope, key);
    if (r && r.locked_until > t) {
      return {
        allowed: false,
        ip,
        account,
        scope,
        retryAfter: Math.ceil((r.locked_until - t) / 1000),
        lockedUntil: r.locked_until,
        fails: r.fails,
      };
    }
  }
  return { allowed: true, ip, account, retryAfter: 0 };
}

/** 顺手清理 24 小时前的过期计数，避免表无限长大（概率执行，开销可忽略） */
function pruneStale(t) {
  try {
    db.prepare('DELETE FROM login_guard WHERE last_at < ? AND locked_until < ?').run(
      t - 24 * 3600 * 1000,
      t
    );
  } catch {
    // 清理失败不影响主流程
  }
}

/** 记一次失败，返回最快解锁时间（秒） */
export function recordFailure(ip, account) {
  const t = Date.now();
  if (Math.random() < 0.05) pruneStale(t);
  const res = {
    ip: bump('ip', ip, GUARD_RULES.ip, t),
    pair: bump('pair', `${ip}|${account}`, GUARD_RULES.pair, t),
    account: bump('account', account, GUARD_RULES.account, t),
  };
  const lockedUntil = Math.max(res.ip.lockedUntil, res.pair.lockedUntil, res.account.lockedUntil);
  return {
    fails: res.pair.fails || res.ip.fails,
    lockedUntil,
    retryAfter: lockedUntil > t ? Math.ceil((lockedUntil - t) / 1000) : 0,
  };
}

/** 登录成功：只清掉与这个账号相关的计数，IP 层历史仍保留（防同源横扫） */
export function recordSuccess(ip, account) {
  db.prepare("DELETE FROM login_guard WHERE scope = 'pair' AND key = ?").run(`${ip}|${account}`);
  db.prepare("DELETE FROM login_guard WHERE scope = 'account' AND key = ?").run(account);
}

/** 失败后拖一点时间，正常用户无感，脚本撞库会被 60 req/min 级的速度卡住 */
export function failureDelay(fails = 1) {
  return Math.min(1200, 200 + 120 * Math.max(1, fails));
}

export function logEvent({ ip, username, ok, reason = '', ua = '' }) {
  try {
    db.prepare('INSERT INTO login_events(ip, username, ok, reason, ua, at) VALUES(?,?,?,?,?,?)').run(
      String(ip || '').slice(0, 64),
      String(username || '').slice(0, LIMIT_USERNAME),
      ok ? 1 : 0,
      String(reason || '').slice(0, 60),
      String(ua || '').slice(0, 180),
      now()
    );
    const total = db.prepare('SELECT COUNT(*) n FROM login_events').get().n;
    if (total > 400) {
      db.prepare(
        'DELETE FROM login_events WHERE id NOT IN (SELECT id FROM login_events ORDER BY id DESC LIMIT 300)'
      ).run();
    }
  } catch {
    // 日志失败不影响登录
  }
}

/* ---------------- 后台查看 / 解封 ---------------- */

export function securityOverview() {
  const t = Date.now();
  const locks = db
    .prepare('SELECT scope, key, fails, last_at, locked_until FROM login_guard WHERE locked_until > ? ORDER BY locked_until DESC')
    .all(t)
    .map((r) => ({
      scope: r.scope,
      scopeLabel: GUARD_RULES[r.scope]?.label || r.scope,
      key: r.key,
      fails: r.fails,
      lastAt: r.last_at,
      retryAfter: Math.ceil((r.locked_until - t) / 1000),
    }));

  const since = now(new Date(t - 24 * 3600 * 1000));
  const fail24 = db
    .prepare('SELECT COUNT(*) n FROM login_events WHERE ok = 0 AND at >= ?')
    .get(since).n;
  const ok24 = db.prepare('SELECT COUNT(*) n FROM login_events WHERE ok = 1 AND at >= ?').get(since).n;
  const events = db
    .prepare('SELECT id, ip, username, ok, reason, ua, at FROM login_events ORDER BY id DESC LIMIT 40')
    .all();

  return {
    rules: Object.entries(GUARD_RULES).map(([scope, r]) => ({
      scope,
      label: r.label,
      max: r.max,
      windowMinutes: WINDOW / 60000,
      lockMinutes: r.lock / 60000,
    })),
    locks,
    events,
    stats: { fail24, ok24 },
    serverTime: now(),
  };
}

export function unlock({ scope = '', key = '' } = {}) {
  if (scope && key) {
    const r = db.prepare('DELETE FROM login_guard WHERE scope = ? AND key = ?').run(scope, key);
    return r.changes;
  }
  const r = db.prepare('DELETE FROM login_guard WHERE locked_until > ?').run(Date.now());
  return r.changes;
}
