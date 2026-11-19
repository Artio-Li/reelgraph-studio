import { Router } from 'express';
import { requireAuth } from '../auth.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  createProduction, planProduction, listProductions, listBatches, getProduction,
  enqueueBatch, retryProduction, cancelProduction, listProviders, listVoices,
} from '../director.js';
import { CFG, MEDIA_DIR } from '../config.js';
import { db, uid, now, addCredits, priceOf } from '../db.js';
import { generateCanvasImage } from '../canvasAI.js';
import { STYLE_PRESETS } from '../styles.js';
import { STORY_STRUCTURES, SHOT_RECIPES, CHARACTER_CARDS } from '../presets.js';

const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');

const r = Router();

function normalizeBrief(body) {
  const pipelineMode = ['keyframe', 'chain', 'standard'].includes(body?.pipelineMode)
    ? body.pipelineMode
    : (body?.chain === true ? 'chain' : 'standard');
  const brief = {
    direction: String(body?.direction || '').trim().slice(0, 500),
    keywords: String(body?.keywords || '').trim().slice(0, 500),
    totalSeconds: Math.min(60, Math.max(5, Number(body?.totalSeconds) || 30)),
    shotSeconds: CFG.videoDurations.includes(Number(body?.shotSeconds)) ? Number(body.shotSeconds) : 10,
    size: CFG.sizes.includes(body?.size) ? body.size : '9:16',
    style: String(body?.style || '').trim().slice(0, 300),
    characterDescription: String(body?.characterDescription || '').trim().slice(0, 300),
    characterRefs: Array.isArray(body?.characterRefs)
      ? body.characterRefs
        .filter((url) => typeof url === 'string' && (url.startsWith('/uploads/') || url.startsWith('/media/')))
        .slice(0, 4)
      : [],
    pipelineMode,
    chain: pipelineMode === 'chain',
    transition: body?.transition === 'fade' ? 'fade' : 'cut',
    voiceoverEnabled: body?.voiceoverEnabled === true,
    voiceId: String(body?.voiceId || 'xiaoxiao').slice(0, 32),
    subtitlesEnabled: body?.subtitlesEnabled === true || body?.voiceoverEnabled === true,
    bgmUrl: typeof body?.bgmUrl === 'string' && body.bgmUrl.startsWith('/uploads/') ? body.bgmUrl : '',
    bgmVolume: Number.isFinite(Number(body?.bgmVolume)) ? Math.max(0, Math.min(1, Number(body.bgmVolume))) : 0.22,
    provider: String(body?.provider || 'chatgpt2api').slice(0, 40),
    styleId: String(body?.styleId || '').slice(0, 40),
    storyId: String(body?.storyId || '').slice(0, 40),
    shotId: String(body?.shotId || '').slice(0, 40),
    characterId: String(body?.characterId || '').slice(0, 40),
  };
  if (!brief.direction) throw Object.assign(new Error('请填写创作方向'), { status: 400 });
  return brief;
}

r.get('/presets', requireAuth, (_req, res) => {
  res.json({
    stories: STORY_STRUCTURES,
    shots: SHOT_RECIPES,
    characters: CHARACTER_CARDS,
    voices: listVoices(),
  });
});

r.get('/styles', requireAuth, (_req, res) => {
  res.json({ styles: STYLE_PRESETS });
});

r.get('/providers', requireAuth, (_req, res) => {
  res.json({ providers: listProviders(), defaultProvider: 'chatgpt2api', voices: listVoices() });
});

r.post('/reference-image', requireAuth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim().slice(0, 600);
    if (prompt.length < 4) throw Object.assign(new Error('请先用文字描述人物长相'), { status: 400 });
    const provider = String(req.body?.provider || 'chatgpt2api');
    const cost = priceOf('image', {});
    if (Number(req.user.credits || 0) < cost) {
      throw Object.assign(new Error(`积分不足，本次需要 ${cost}`), { status: 402 });
    }
    const out = await generateCanvasImage({
      prompt, provider, size: '1:1', resolution: '1K', jobId: uid('ref_'),
    });
    const ext = path.extname(out.fileName) || '.png';
    const filename = `${uid('up_')}${ext}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.copyFileSync(path.join(MEDIA_DIR, out.fileName), path.join(UPLOAD_DIR, filename));
    db.prepare('INSERT INTO uploads(id, user_id, filename, mime, bytes, created_at) VALUES(?,?,?,?,?,?)')
      .run(uid('u_'), req.user.id, filename, out.mime, out.bytes, now());
    if (cost > 0) addCredits(req.user.id, -cost, '自动导演参考图');
    res.status(201).json({
      image: { url: `/uploads/${filename}`, bytes: out.bytes, model: out.model || null, provider, cost },
    });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

r.post('/plan', requireAuth, async (req, res) => {
  try {
    const brief = normalizeBrief(req.body);
    const { plan } = await planProduction(brief);
    res.json({ plan, brief });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.post('/batch', requireAuth, (req, res) => {
  try {
    const baseBody = { ...req.body, direction: '批量占位' };
    const shared = normalizeBrief(baseBody);
    const lines = String(req.body?.directions || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) throw Object.assign(new Error('请至少填写一条创作方向'), { status: 400 });
    const briefs = lines.slice(0, 20).map((line) => {
      const [direction, ...rest] = line.split('|');
      return { ...shared, direction: direction.trim(), keywords: rest.join('|').trim() };
    });
    const batch = enqueueBatch(req.user.id, briefs, { name: req.body?.name });
    res.status(201).json({ batch });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.get('/batches', requireAuth, (req, res) => {
  res.json({ batches: listBatches(req.user.id) });
});

r.post('/', requireAuth, async (req, res) => {
  try {
    const brief = normalizeBrief(req.body);
    const customPlan = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : null;
    const production = await createProduction(req.user.id, brief, customPlan);
    res.status(201).json({ production });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.get('/', requireAuth, (req, res) => {
  res.json({ productions: listProductions(req.user.id) });
});

r.post('/:id/cancel', requireAuth, (req, res) => {
  try {
    const production = cancelProduction(req.user.id, req.params.id);
    res.json({ production });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.post('/:id/retry', requireAuth, async (req, res) => {
  try {
    const failedOnly = req.body?.failedOnly === true;
    const production = await retryProduction(req.user.id, req.params.id, { failedOnly });
    res.json({ production });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

// 纯幂等读取：推进逻辑统一交由后台 startDirectorScheduler 执行，避免多端轮询竞争
r.get('/:id', requireAuth, (req, res) => {
  try {
    const production = getProduction(req.user.id, req.params.id);
    res.json({ production });
  } catch (error) {
    res.status(error.status || 404).json({ error: error.message });
  }
});

export default r;
