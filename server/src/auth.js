import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { CFG } from './config.js';
import { db, uid, now, addCredits, getSetting } from './db.js';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, CFG.jwtSecret, { expiresIn: `${CFG.jwtDays}d` });

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name || u.email.split('@')[0],
    role: u.role,
    credits: u.credits,
    status: u.status,
    createdAt: u.created_at,
  };
}

export function createUser({ email, password, name, role = 'user', credits, invitedBy = null }) {
  const id = uid('u_');
  const gift = credits ?? Number(getSetting('signupCredits') || 0);
  db.prepare(
    'INSERT INTO users(id, email, password_hash, name, role, credits, status, created_at, invited_by) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run(id, email.toLowerCase().trim(), hashPassword(password), name || null, role, 0, 'active', now(), invitedBy);
  if (gift > 0) addCredits(id, gift, '注册赠送');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/** 邀请码 = 用户 id 去掉前缀后取前 8 位，双向可查 */
export function inviteCodeOf(userId) {
  return String(userId || '').replace(/^u_/, '').slice(0, 8);
}

export function findByInviteCode(code) {
  if (!code || String(code).length < 4) return null;
  const rows = db.prepare('SELECT * FROM users').all();
  return rows.find((u) => inviteCodeOf(u.id) === String(code).trim()) || null;
}

export function invitedUsers(userId) {
  return db.prepare('SELECT id, email, name, created_at, credits FROM users WHERE invited_by = ? ORDER BY created_at DESC')
    .all(userId);
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, CFG.jwtSecret);
    const user = findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    if (user.status !== 'active') return res.status(403).json({ error: '账号已被封禁' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}
