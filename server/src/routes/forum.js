import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, uid, now } from '../db.js';

const r = Router();

export const CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'chat', label: '开麦吐槽' },
  { key: 'premiere', label: 'AI 大片首映' },
  { key: 'fail', label: 'AI 翻车现场' },
  { key: 'help', label: '交流互助' },
  { key: 'notice', label: '官方公告' },
];

const shape = (p, userId) => ({
  id: p.id,
  category: p.category,
  title: p.title,
  content: p.content,
  likes: p.likes,
  createdAt: p.created_at,
  author: { name: p.author_name || p.author_email?.split('@')[0] || '匿名', id: p.user_id },
  liked: !!p.liked,
  replyCount: p.reply_count || 0,
});

r.get('/posts', requireAuth, (req, res) => {
  const { category, q } = req.query;
  const where = [];
  const args = [];
  if (category && category !== 'all') { where.push('p.category = ?'); args.push(category); }
  if (q) { where.push('(p.title LIKE ? OR p.content LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT p.*, u.name AS author_name, u.email AS author_email,
      (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count,
      EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
    FROM posts p LEFT JOIN users u ON u.id = p.user_id
    ${w}
    ORDER BY p.created_at DESC
    LIMIT 50
  `).all(req.user.id, ...args);

  res.json({ categories: CATEGORIES, posts: rows.map((p) => shape(p, req.user.id)) });
});

r.post('/posts', requireAuth, (req, res) => {
  const { title, content, category } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: '请填写标题' });
  if (!CATEGORIES.some((c) => c.key === category)) return res.status(400).json({ error: '分类不存在' });
  const id = uid('post_');
  db.prepare('INSERT INTO posts(id, user_id, category, title, content, created_at) VALUES(?,?,?,?,?,?)')
    .run(id, req.user.id, category, title.trim().slice(0, 120), (content || '').slice(0, 4000), now());
  res.json({ ok: true, id });
});

r.post('/posts/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const liked = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.user.id);

  if (liked) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    db.prepare('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(post.id);
  } else {
    db.prepare('INSERT INTO post_likes(post_id, user_id, created_at) VALUES(?,?,?)')
      .run(post.id, req.user.id, now());
    db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(post.id);
  }
  const row = db.prepare('SELECT likes FROM posts WHERE id = ?').get(post.id);
  res.json({ likes: row.likes, liked: !liked });
});

r.get('/posts/:id/replies', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name AS author_name, u.email AS author_email
    FROM replies r LEFT JOIN users u ON u.id = r.user_id
    WHERE r.post_id = ? ORDER BY r.created_at ASC LIMIT 200
  `).all(req.params.id);
  res.json({
    replies: rows.map((x) => ({
      id: x.id,
      content: x.content,
      createdAt: x.created_at,
      author: { name: x.author_name || x.author_email?.split('@')[0] || '匿名' },
    })),
  });
});

r.post('/posts/:id/replies', requireAuth, (req, res) => {
  const content = String(req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: '请输入回复内容' });
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  db.prepare('INSERT INTO replies(id, post_id, user_id, content, created_at) VALUES(?,?,?,?,?)')
    .run(uid('rep_'), post.id, req.user.id, content.slice(0, 2000), now());
  res.json({ ok: true });
});

r.delete('/posts/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权删除' });
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(post.id);
  res.json({ ok: true });
});

export default r;
