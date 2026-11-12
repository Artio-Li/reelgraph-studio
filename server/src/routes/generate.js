import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { CFG } from '../config.js';
import {
  db, uid, now, createJob, getJob, updateJob, listJobs, addCredits, priceOf, getSettings,
} from '../db.js';
import * as muse from '../muse.js';
import * as gemini from '../gemini.js';
import * as antigravity from '../antigravity.js';
import { applyRealism, realismEnabled } from '../realism.js';

const r = Router();

const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `${uid('up_')}${ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video|audio)\//.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('仅支持图片 / 视频 / 音频 / PDF 参考素材'), ok);
  },
});

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.heic': 'image/heic', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

/** 把平台本地上传的参考素材转成 data URL，上游无需公网访问权限 */
function toDataUrl(localUrl) {
  const name = path.basename(String(localUrl));
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function normalizeRefs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      if (item.startsWith('/uploads/')) {
        const d = toDataUrl(item);
        if (d) out.push({ url: d });
      } else if (/^(https?:|data:)/i.test(item)) {
        out.push({ url: item });
      }
    } else if (item.url) {
      out.push(item);
    }
  }
  return out;
}

/* ------------------------------ 上传 ------------------------------ */
r.post('/upload', requireAuth, upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map((f) => {
    db.prepare('INSERT INTO uploads(id, user_id, filename, mime, bytes, created_at) VALUES(?,?,?,?,?,?)')
      .run(uid('u_'), req.user.id, f.filename, f.mimetype, f.size, now());
    return { url: `/uploads/${f.filename}`, name: f.originalname, bytes: f.size, mime: f.mimetype };
  });
  if (!files.length) return res.status(400).json({ error: '没有收到文件' });
  res.json({ files });
});

/* ------------------------------ 视频 ------------------------------ */
r.post('/videos', requireAuth, async (req, res) => {
  const { prompt, duration = 5, size = '16:9', images = [], model = 'muse-video', extra = null } = req.body || {};
  if (!prompt || String(prompt).trim().length < 2) {
    return res.status(400).json({ error: '请填写画面描述' });
  }
  const dur = CFG.videoDurations.includes(Number(duration)) ? Number(duration) : 5;
  const params = {
    duration: dur, size: CFG.sizes.includes(size) ? size : '16:9', images, extra,
    realism: realismEnabled(),
  };
  const cost = priceOf('video', params);

  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (fresh.credits < cost) {
    return res.status(402).json({ error: `积分不足，本次需要 ${cost}，当前 ${fresh.credits}` });
  }

  const job = createJob(req.user.id, 'video', String(prompt).trim(), params, cost);
  addCredits(req.user.id, -cost, '创建视频任务', job.id);

  try {
    const refs = normalizeRefs(images);
    const payload = {
      prompt: applyRealism(prompt, 'video'),
      model,
      duration: dur,
      size: params.size,
    };
    if (refs.length) payload.images = refs;
    if (extra) payload.extra = String(extra).slice(0, 500);

    const out = await muse.createVideo(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('上游未返回任务 ID');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 15 });
    res.json({ job: getJob(job.id) });
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(req.user.id, cost, '任务创建失败退还', job.id);
    updateJob(job.id, { refunded: 1 });
    res.status(502).json({ error: `创建任务失败：${e.message}`, refunded: true });
  }
});

/* ------------------------------ 图片 ------------------------------ */
r.post('/images', requireAuth, async (req, res) => {
  const {
    prompt, size = '1:1', images = [], provider = 'muse', model = null, resolution = '1K',
  } = req.body || {};
  if (!prompt || String(prompt).trim().length < 2) {
    return res.status(400).json({ error: '请填写提示词' });
  }
  const params = {
    size: CFG.sizes.includes(size) ? size : '1:1', images,
    provider: ['gemini', 'antigravity'].includes(provider) ? provider : 'muse', model, resolution,
    realism: realismEnabled(),
  };
  const cost = priceOf('image', params);

  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (fresh.credits < cost) {
    return res.status(402).json({ error: `积分不足，本次需要 ${cost}，当前 ${fresh.credits}` });
  }

  const job = createJob(req.user.id, 'image', String(prompt).trim(), params, cost);
  addCredits(req.user.id, -cost, '创建图片任务', job.id);

  try {
    const refs = normalizeRefs(images);
    if (['gemini', 'antigravity'].includes(params.provider)) {
      const target = params.provider === 'antigravity' ? antigravity : gemini;
      const out = await target.generateImage({
        prompt: applyRealism(prompt, 'image'), model, size: params.size, resolution, images: refs, jobId: job.id,
      });
      updateJob(job.id, {
        status: 'completed', progress: 100, media_file: out.fileName,
        result: JSON.stringify({
          url: out.url, localUrl: out.url, bytes: out.bytes, mime: out.mime,
          model: out.model, note: out.note, usage: out.usage,
        }),
        finished_at: Date.now(),
      });
      return res.json({ job: getJob(job.id) });
    }
    const payload = { prompt: applyRealism(prompt, 'image'), model: 'muse-image', size: params.size };
    if (refs.length) payload.images = refs;

    const out = await muse.createImageTask(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('上游未返回任务 ID');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 10 });
    res.json({ job: getJob(job.id) });
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(req.user.id, cost, '任务创建失败退还', job.id);
    updateJob(job.id, { refunded: 1 });
    res.status(502).json({ error: `创建任务失败：${e.message}`, refunded: true });
  }
});

/* ------------------------------ 任务 ------------------------------ */
r.get('/jobs', requireAuth, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize) || 24));
  const out = listJobs({
    userId: req.user.role === 'admin' && req.query.all === '1' ? null : req.user.id,
    type: req.query.type || null,
    status: req.query.status || null,
    page,
    pageSize,
  });
  res.json(out);
});

r.get('/jobs/:id', requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权查看' });
  }
  res.json({ job });
});

r.delete('/jobs/:id', requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权删除' });
  }
  if (job.mediaFile) {
    try { fs.unlinkSync(path.join(CFG.dataDir, 'media', job.mediaFile)); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

/* --------------------------- 元信息 / 定价 --------------------------- */
r.get('/meta', requireAuth, (_req, res) => {
  const s = getSettings();
  res.json({
    siteName: s.siteName,
    notice: s.notice,
    realismEnabled: s.realismEnabled === '1',
    durations: CFG.videoDurations,
    sizes: CFG.sizes,
    price: {
      videoBase: Number(s.priceVideoBase),
      videoPerSecond: Number(s.priceVideoPerSecond),
      image: Number(s.priceImage),
    },
  });
});

export default r;
