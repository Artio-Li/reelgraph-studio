import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, uid, now, priceOf } from '../db.js';

const r = Router();

const shape = (q) => {
  let params = {};
  try { params = JSON.parse(q.params || '{}'); } catch { params = {}; }
  return {
    id: q.id,
    prompt: q.prompt,
    params,
    intervalMin: q.interval_min,
    maxRuns: q.max_runs,
    runs: q.runs,
    status: q.status,
    nextRunAt: q.next_run_at,
    lastRunAt: q.last_run_at,
    jobId: q.job_id,
    note: q.note,
    createdAt: q.created_at,
  };
};

r.get('/queue', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM queue_items WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(req.user.id);
  res.json({
    items: rows.map(shape),
    stats: {
      total: rows.length,
      pending: rows.filter((x) => x.status === 'pending').length,
      running: rows.filter((x) => x.status === 'running').length,
      done: rows.filter((x) => x.status === 'done').length,
      paused: rows.filter((x) => x.status === 'paused').length,
    },
  });
});

r.post('/queue', requireAuth, (req, res) => {
  const { prompt, duration = 5, size = '16:9', intervalMin = 5, maxRuns = 3, images = [] } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: '请先输入提示词并选择模型' });

  const interval = Math.max(1, Math.min(1440, Number(intervalMin) || 5));
  const runs = Math.max(1, Math.min(50, Number(maxRuns) || 3));
  const params = { duration: Number(duration) || 5, size: size || '16:9', images };

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM queue_items WHERE user_id = ?')
    .get(req.user.id).m;

  const id = uid('q_');
  db.prepare(`
    INSERT INTO queue_items(id, user_id, prompt, params, interval_min, max_runs, sort_order, status, next_run_at, created_at)
    VALUES(?,?,?,?,?,?,?,'pending',?,?)
  `).run(id, req.user.id, prompt.trim(), JSON.stringify(params), interval, runs, maxOrder + 1, now(), now());

  res.json({ item: shape(db.prepare('SELECT * FROM queue_items WHERE id = ?').get(id)) });
});

r.patch('/queue/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM queue_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });

  const { status, intervalMin, maxRuns } = req.body || {};

  if (status === 'paused') {
    db.prepare("UPDATE queue_items SET status = 'paused', note = ? WHERE id = ?").run('任务已暂停', row.id);
  } else if (status === 'pending') {
    // 恢复：立即到期，或维持原计划
    const next = row.next_run_at && row.next_run_at > now() ? row.next_run_at : now();
    db.prepare("UPDATE queue_items SET status = 'pending', next_run_at = ?, note = ? WHERE id = ?")
      .run(next, '任务已恢复', row.id);
  }

  if (intervalMin != null) {
    db.prepare('UPDATE queue_items SET interval_min = ? WHERE id = ?')
      .run(Math.max(1, Math.min(1440, Number(intervalMin) || 5)), row.id);
  }
  if (maxRuns != null) {
    db.prepare('UPDATE queue_items SET max_runs = ? WHERE id = ?')
      .run(Math.max(1, Math.min(50, Number(maxRuns) || 3)), row.id);
  }

  res.json({ item: shape(db.prepare('SELECT * FROM queue_items WHERE id = ?').get(row.id)) });
});

/* 上移 / 下移 */
r.post('/queue/:id/move', requireAuth, (req, res) => {
  const dir = req.body?.dir === 'up' ? -1 : 1;
  const row = db.prepare('SELECT * FROM queue_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: '任务不存在' });

  const neighbor = db.prepare(
    dir < 0
      ? 'SELECT * FROM queue_items WHERE user_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1'
      : 'SELECT * FROM queue_items WHERE user_id = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1'
  ).get(req.user.id, row.sort_order);

  if (!neighbor) return res.json({ ok: true });

  db.prepare('UPDATE queue_items SET sort_order = ? WHERE id = ?').run(neighbor.sort_order, row.id);
  db.prepare('UPDATE queue_items SET sort_order = ? WHERE id = ?').run(row.sort_order, neighbor.id);

  const rows = db
    .prepare('SELECT * FROM queue_items WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(req.user.id);
  res.json({ items: rows.map(shape) });
});

r.delete('/queue/done', requireAuth, (req, res) => {
  const n = db.prepare("DELETE FROM queue_items WHERE user_id = ? AND status IN ('done','failed')").run(req.user.id).changes;
  res.json({ ok: true, removed: n });
});

r.delete('/queue', requireAuth, (req, res) => {
  const n = db.prepare('DELETE FROM queue_items WHERE user_id = ?').run(req.user.id).changes;
  res.json({ ok: true, removed: n });
});

r.delete('/queue/:id', requireAuth, (req, res) => {
  const n = db.prepare('DELETE FROM queue_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id).changes;
  if (!n) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

export { shape as shapeQueue };
export default r;
