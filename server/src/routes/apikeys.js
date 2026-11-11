import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, uid, now } from '../db.js';
import { CFG } from '../config.js';
import * as muse from '../muse.js';

const r = Router();

/* ------------------------- 平台自己的 API Key ------------------------- */
const genKey = () => 'sk-xm-' + crypto.randomBytes(24).toString('base64url');

r.get('/keys', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json({
    keys: rows.map((k) => ({
      id: k.id,
      name: k.name,
      key: k.key.slice(0, 12) + '…' + k.key.slice(-4),
      full: k.key,
      lastUsed: k.last_used,
      createdAt: k.created_at,
    })),
    baseUrl: `${CFG.publicBase || ''}/v1`,
  });
});

r.post('/keys', requireAuth, (req, res) => {
  const name = String(req.body?.name || '默认密钥').slice(0, 40);
  const id = uid('key_');
  const key = genKey();
  db.prepare('INSERT INTO api_keys(id, user_id, name, key, created_at) VALUES(?,?,?,?,?)')
    .run(id, req.user.id, name, key, now());
  res.json({ id, name, key });
});

r.delete('/keys/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== 'admin')) {
    return res.status(404).json({ error: '密钥不存在' });
  }
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

/* ------------------------ OpenAI 兼容代理层 ------------------------ */
/** 用平台的 sk- key 鉴权，把请求转发给上游 muse2api */
export function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: { message: '缺少 API Key', type: 'invalid_request_error' } });
  }
  const row = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(token);
  if (!row) {
    return res.status(401).json({ error: { message: 'API Key 无效', type: 'invalid_request_error' } });
  }
  db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(now(), row.id);
  req.apiUser = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(row.user_id, 'active');
  if (!req.apiUser) {
    return res.status(403).json({ error: { message: '账号不可用', type: 'invalid_request_error' } });
  }
  req.apiKeyId = row.id;
  next();
}

export default r;
