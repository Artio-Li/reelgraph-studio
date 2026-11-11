import { Router } from 'express';
import { requireAuth, requireAdmin, publicUser } from '../auth.js';
import { db, addCredits, getSettings, setSetting, upsertAccount } from '../db.js';
import * as muse from '../muse.js';

const r = Router();
r.use(requireAuth, requireAdmin);

r.get('/overview', (_req, res) => {  const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const jobs = db.prepare("SELECT COUNT(*) n FROM jobs").get().n;
  const done = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed'").get().n;
  const failed = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='failed'").get().n;
  const running = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','processing')").get().n;
  const videos = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND type='video'").get().n;
  const images = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND type='image'").get().n;
  const credits = db.prepare("SELECT COALESCE(SUM(credits),0) n FROM users").get().n;
  const consumed = db.prepare("SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE delta < 0").get().n;
  const accounts = db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
  const recent = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 8').all();
  res.json({
    stats: { users, jobs, done, failed, running, videos, images, credits, consumed, accounts },
    recent,
  });
});

r.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare('SELECT * FROM users WHERE email LIKE ? ORDER BY created_at DESC LIMIT 200').all(`%${q}%`)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 200').all();
  res.json({ users: rows.map(publicUser) });
});

r.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const { credits, role, status, password } = req.body || {};
  if (credits !== undefined && credits !== null) {
    const delta = Number(credits);
    if (delta !== 0) addCredits(user.id, delta, delta > 0 ? '管理员充值' : '管理员扣减');
  }
  if (role && ['user', 'admin'].includes(role)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  }
  if (status && ['active', 'banned'].includes(status)) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

/* ------------------------------ 订单 ------------------------------ */
r.get('/orders', (req, res) => {
  const { kind } = req.query;
  const base = `SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id`;
  const rows = kind
    ? db.prepare(`${base} WHERE o.kind = ? ORDER BY o.created_at DESC LIMIT 200`).all(kind)
    : db.prepare(`${base} ORDER BY o.created_at DESC LIMIT 200`).all();
  res.json({ orders: rows });
});

/* ------------------------------ 社区 ------------------------------ */
r.get('/posts', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.email,
      (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count
    FROM posts p LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 200
  `).all();
  res.json({ posts: rows });
});

r.delete('/posts/:id', (req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------------------- 7 天趋势 ---------------------------- */
r.get('/trend', (_req, res) => {
  const dayMs = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const from = today.getTime() - i * dayMs;
    const to = from + dayMs;
    days.push({
      date: new Date(from).toISOString().slice(5, 10),
      jobs: db.prepare('SELECT COUNT(*) n FROM jobs WHERE created_at >= ? AND created_at < ?').get(from, to).n,
      credits: db.prepare("SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE delta < 0 AND created_at >= ? AND created_at < ?").get(from, to).n,
      recharge: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE kind='recharge' AND status='paid' AND created_at >= ? AND created_at < ?").get(from, to).n,
    });
  }
  res.json({ days });
});

r.get('/settings', (_req, res) => res.json({ settings: getSettings() }));
r.patch('/settings', (req, res) => {
  const allow = ['siteName', 'signupCredits', 'priceVideoBase', 'priceVideoPerSecond', 'priceImage', 'allowRegister', 'notice'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allow.includes(k)) setSetting(k, v);
  }
  res.json({ settings: getSettings() });
});

r.get('/system', async (_req, res) => {
  const out = { upstream: null, error: null };
  try {
    const st = await muse.status();
    out.upstream = st;
    for (const a of st.accounts || []) {
      upsertAccount({
        upstreamId: a.id,
        label: a.label,
        status: a.ok === true ? 'ok' : a.ok === false ? 'error' : 'unknown',
        expiresAt: a.expires_at || null,
        quota: a.quota ? JSON.stringify(a.quota) : null,
        note: a.note || null,
      });
    }
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});

r.post('/keepalive', async (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM accounts WHERE upstream_id IS NOT NULL').all();
    const results = [];
    for (const row of rows) {
      try {
        const out = await muse.keepaliveAccount(row.upstream_id);
        results.push({ id: row.id, label: row.label, ok: true, out });
      } catch (e) {
        results.push({ id: row.id, label: row.label, ok: false, error: e.message });
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default r;
