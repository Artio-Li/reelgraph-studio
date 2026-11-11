import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CFG, DB_FILE, MEDIA_DIR } from './config.js';

fs.mkdirSync(CFG.dataDir, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  credits       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,              -- video | image
  prompt      TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}', -- 请求参数 JSON
  upstream_id TEXT,
  status      TEXT NOT NULL DEFAULT 'queued', -- queued|processing|completed|failed|canceled
  progress    INTEGER NOT NULL DEFAULT 0,
  cost        INTEGER NOT NULL DEFAULT 0,
  refunded    INTEGER NOT NULL DEFAULT 0,
  result      TEXT,
  error       TEXT,
  media_file  TEXT,
  account_id  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_user  ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(status);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  upstream_id TEXT UNIQUE,
  label       TEXT NOT NULL,
  owner_id    TEXT,                       -- null = 公共池
  status      TEXT NOT NULL DEFAULT 'unknown',
  expires_at  INTEGER,
  quota       TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  synced_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  job_id        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bind_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | done | expired
  account_id TEXT,
  message    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bind_user ON bind_codes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- recharge | membership
  amount     REAL NOT NULL DEFAULT 0,    -- 人民币
  credits    INTEGER NOT NULL DEFAULT 0,
  plan       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | paid | canceled
  created_at INTEGER NOT NULL,
  paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    TEXT PRIMARY KEY,
  plan       TEXT NOT NULL,
  credits    INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'chat',
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  likes      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS replies (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '默认密钥',
  key        TEXT NOT NULL UNIQUE,
  last_used  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  params       TEXT NOT NULL DEFAULT '{}',
  interval_min INTEGER NOT NULL DEFAULT 5,
  max_runs     INTEGER NOT NULL DEFAULT 3,
  runs         INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|running|paused|done|failed
  next_run_at  INTEGER,
  last_run_at  INTEGER,
  job_id       TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_user ON queue_items(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_queue_due ON queue_items(status, next_run_at);

CREATE TABLE IF NOT EXISTS canvases (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '未命名画布',
  doc_json   TEXT NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canvases_user ON canvases(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS canvas_runs (
  id             TEXT PRIMARY KEY,
  canvas_id      TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  target_nodes   TEXT NOT NULL DEFAULT '[]',
  force          INTEGER NOT NULL DEFAULT 0,
  estimated_cost INTEGER NOT NULL DEFAULT 0,
  actual_cost    INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  finished_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_canvas_runs_canvas ON canvas_runs(canvas_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_runs_user ON canvas_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS node_runs (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  canvas_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  node_type   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  input_hash  TEXT NOT NULL,
  input_json  TEXT NOT NULL DEFAULT '{}',
  job_id      TEXT,
  cached_from TEXT,
  output_json TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_node_runs_run ON node_runs(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_node_runs_cache ON node_runs(user_id, canvas_id, node_id, input_hash, status);
`);

// 邀请关系（老库自动补列）
try {
  db.exec('ALTER TABLE users ADD COLUMN invited_by TEXT');
} catch { /* 已存在 */ }

export const uid = (p = '') => p + crypto.randomBytes(9).toString('hex');
export const now = () => Date.now();

/* ------------------------------- settings ------------------------------- */
const DEFAULT_SETTINGS = {
  siteName: 'ReelGraph Studio',
  signupCredits: String(CFG.signupCredits),
  priceVideoBase: String(CFG.price.videoBase),
  priceVideoPerSecond: String(CFG.price.videoPerSecond),
  priceImage: String(CFG.price.image),
  allowRegister: CFG.allowRegister ? '1' : '0',
  notice: '',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function getSetting(key) {
  return getSettings()[key] ?? DEFAULT_SETTINGS[key];
}

/* -------------------------------- ledger -------------------------------- */
export function addCredits(userId, delta, reason, jobId = null) {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  const after = user.credits + delta;
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(after, userId);
  db.prepare(
    'INSERT INTO ledger(id, user_id, delta, balance_after, reason, job_id, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(uid('l_'), userId, delta, after, reason, jobId, now());
  return after;
}

export function priceOf(type, params = {}) {
  const s = getSettings();
  if (type === 'video') {
    const sec = Number(params.duration) || 5;
    return Number(s.priceVideoBase) + Number(s.priceVideoPerSecond) * sec;
  }
  return Number(s.priceImage);
}

/* --------------------------------- jobs --------------------------------- */
export function createJob(userId, type, prompt, params, cost) {
  const id = uid('job_');
  const ts = now();
  db.prepare(
    `INSERT INTO jobs(id, user_id, type, prompt, params, status, progress, cost, created_at, updated_at)
     VALUES(?,?,?,?,?,'queued',0,?,?,?)`
  ).run(id, userId, type, prompt, JSON.stringify(params || {}), cost, ts, ts);
  return getJob(id);
}

export function getJob(id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return j ? shapeJob(j) : null;
}

export function shapeJob(j) {
  let params = {};
  let result = null;
  try { params = JSON.parse(j.params || '{}'); } catch { params = {}; }
  try { result = j.result ? JSON.parse(j.result) : null; } catch { result = null; }
  return {
    id: j.id,
    userId: j.user_id,
    type: j.type,
    prompt: j.prompt,
    params,
    upstreamId: j.upstream_id || null,
    status: j.status,
    progress: j.progress,
    cost: j.cost,
    refunded: !!j.refunded,
    result,
    error: j.error || null,
    mediaUrl: j.media_file ? `/media/${j.media_file}` : null,
    mediaFile: j.media_file,
    accountId: j.account_id,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
    finishedAt: j.finished_at,
  };
}

export function updateJob(id, patch) {
  const allowed = ['upstream_id', 'status', 'progress', 'result', 'error', 'media_file', 'account_id', 'finished_at', 'refunded'];
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    cols.push(`${k} = ?`);
    vals.push(v === undefined ? null : v);
  }
  if (!cols.length) return;
  cols.push('updated_at = ?');
  vals.push(now(), id);
  db.prepare(`UPDATE jobs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
}

export function listJobs({ userId, type, status, page = 1, pageSize = 24 }) {
  const where = [];
  const args = [];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (status) { where.push('status = ?'); args.push(status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${w}`).get(...args).n;
  const rows = db
    .prepare(`SELECT * FROM jobs ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  return { total, jobs: rows.map(shapeJob) };
}

export function pendingJobs() {
  return db
    .prepare("SELECT * FROM jobs WHERE status IN ('queued','processing') AND upstream_id IS NOT NULL")
    .all()
    .map(shapeJob);
}

/* ------------------------------- accounts ------------------------------- */
export function upsertAccount({ upstreamId, label, ownerId, status, expiresAt, quota, note }) {
  const existing = upstreamId
    ? db.prepare('SELECT * FROM accounts WHERE upstream_id = ?').get(upstreamId)
    : null;
  const ts = now();
  if (existing) {
    db.prepare(
      `UPDATE accounts SET label = ?, status = ?, expires_at = ?, quota = ?, note = ?, synced_at = ?
       WHERE upstream_id = ?`
    ).run(label ?? existing.label, status ?? existing.status,
      expiresAt ?? existing.expires_at, quota ?? existing.quota,
      note ?? existing.note, ts, upstreamId);
    return db.prepare('SELECT * FROM accounts WHERE upstream_id = ?').get(upstreamId);
  }
  const id = uid('acc_');
  db.prepare(
    `INSERT INTO accounts(id, upstream_id, label, owner_id, status, expires_at, quota, note, created_at, synced_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(id, upstreamId ?? null, label || 'Muse 账号', ownerId ?? null,
    status || 'unknown', expiresAt ?? null, quota ?? null, note ?? null, ts, ts);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function listAccounts(ownerId) {
  if (ownerId) {
    return db.prepare('SELECT * FROM accounts WHERE owner_id = ? OR owner_id IS NULL ORDER BY created_at DESC').all(ownerId);
  }
  return db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
}

export function deleteAccountRow(id) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

/* ------------------------------ 绑定码 ------------------------------ */
const BIND_TTL = 20 * 60 * 1000; // 20 分钟

export function createBindCode(userId, label) {
  const code = crypto.randomBytes(16).toString('base64url');
  const ts = now();
  db.prepare(
    'INSERT INTO bind_codes(code, user_id, label, status, created_at, expires_at) VALUES(?,?,?,?,?,?)'
  ).run(code, userId, label || null, 'pending', ts, ts + BIND_TTL);
  return { code, expiresAt: ts + BIND_TTL };
}

export function getBindCode(code) {
  const row = db.prepare('SELECT * FROM bind_codes WHERE code = ?').get(code);
  if (!row) return null;
  if (row.status === 'pending' && row.expires_at < now()) {
    db.prepare("UPDATE bind_codes SET status = 'expired' WHERE code = ?").run(code);
    row.status = 'expired';
  }
  return row;
}

export function finishBindCode(code, { accountId, message }) {
  db.prepare(
    "UPDATE bind_codes SET status = 'done', account_id = ?, message = ?, used_at = ? WHERE code = ?"
  ).run(accountId ?? null, message ?? null, now(), code);
}

export function failBindCode(code, message) {
  db.prepare('UPDATE bind_codes SET message = ? WHERE code = ?').run(message, code);
}
