import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  createProduction, planProduction, listProductions, getProduction, advanceProduction,
} from '../director.js';
import { CFG } from '../config.js';

const r = Router();

function normalizeBrief(body) {
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
        .filter((url) => typeof url === 'string' && url.startsWith('/uploads/'))
        .slice(0, 4)
      : [],
    chain: body?.chain === true,
  };
  if (!brief.direction) throw Object.assign(new Error('请填写创作方向'), { status: 400 });
  return brief;
}

r.post('/plan', requireAuth, async (req, res) => {
  try {
    const brief = normalizeBrief(req.body);
    const { plan } = await planProduction(brief);
    res.json({ plan, brief });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.post('/', requireAuth, async (req, res) => {
  try {
    const brief = normalizeBrief(req.body);
    const production = await createProduction(req.user.id, brief);
    res.status(201).json({ production });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

r.get('/', requireAuth, (req, res) => {
  res.json({ productions: listProductions(req.user.id) });
});

r.get('/:id', requireAuth, async (req, res) => {
  try {
    getProduction(req.user.id, req.params.id);
    const production = (await advanceProduction(req.params.id)) || getProduction(req.user.id, req.params.id);
    res.json({ production });
  } catch (error) {
    res.status(error.status || 404).json({ error: error.message });
  }
});

export default r;
