import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getSetting } from '../db.js';
import * as gemini from '../gemini.js';
import * as antigravity from '../antigravity.js';
import { realismEnabled, REALISM_GENERATOR_RULES } from '../realism.js';

const r = Router();

const PROMPT_SYSTEM = `你是 ReelGraph Studio 的专业 AI 视频提示词导演。用户会提供关键词、可选模板和规格。
你的任务是补全人物、服装、场景、光线、机位、逐秒动作、风格、音频、参数和负面提示词。
输出必须是可直接复制给视频生成模型的完整中文提示词，不要解释创作过程，不要使用 Markdown 代码块。
优先保证人物一致性、动作可执行性、真实手机或摄影机物理表现，避免在短时长内塞入无法完成的动作。`;

r.get('/gemini/meta', requireAuth, async (_req, res) => {
  const officialEnabled = gemini.isEnabled();
  const antigravityEnabled = antigravity.isEnabled();
  let officialModels = { text: gemini.FALLBACK_TEXT_MODELS, image: gemini.FALLBACK_IMAGE_MODELS };
  let antigravityModels = { text: antigravity.FALLBACK_TEXT_MODELS, image: antigravity.FALLBACK_IMAGE_MODELS };
  if (officialEnabled) try { officialModels = await gemini.listModels(); } catch { /* 使用兜底列表 */ }
  if (antigravityEnabled) try { antigravityModels = await antigravity.listModels(); } catch { /* 使用兜底列表 */ }
  res.json({
    enabled: officialEnabled || antigravityEnabled,
    realismEnabled: realismEnabled(),
    models: officialEnabled ? officialModels : antigravityModels,
    defaults: {
      text: officialEnabled ? getSetting('geminiTextModel') : getSetting('antigravityTextModel'),
      image: officialEnabled ? getSetting('geminiImageModel') : getSetting('antigravityImageModel'),
    },
    defaultProvider: officialEnabled ? 'gemini' : antigravityEnabled ? 'antigravity' : 'gemini',
    providers: {
      gemini: {
        id: 'gemini', name: 'Gemini 官方 API', enabled: officialEnabled,
        models: officialModels,
        defaults: { text: getSetting('geminiTextModel'), image: getSetting('geminiImageModel') },
      },
      antigravity: {
        id: 'antigravity', name: 'Antigravity', enabled: antigravityEnabled,
        models: antigravityModels,
        defaults: { text: getSetting('antigravityTextModel'), image: getSetting('antigravityImageModel') },
      },
    },
  });
});

r.post('/gemini/prompts', requireAuth, async (req, res) => {
  const {
    keywords, template = '', purpose = '视频提示词', duration = 10,
    aspectRatio = '9:16', style = '写实真人质感', model, provider = 'gemini',
  } = req.body || {};
  if (!keywords || String(keywords).trim().length < 2) {
    return res.status(400).json({ error: '请至少输入两个字的关键词或需求' });
  }
  const user = [
    `目标：${String(purpose).slice(0, 100)}`,
    `关键词/需求：${String(keywords).slice(0, 12000)}`,
    `时长：${Number(duration) || 10} 秒`,
    `画幅：${String(aspectRatio).slice(0, 20)}`,
    `风格：${String(style).slice(0, 500)}`,
    template ? `参考模板（学习其结构和专业度，不要机械照抄内容）：\n${String(template).slice(0, 30000)}` : '',
    '请直接给出最终完整提示词。',
  ].filter(Boolean).join('\n\n');
  try {
    const system = realismEnabled()
      ? `${PROMPT_SYSTEM}\n\n${REALISM_GENERATOR_RULES}`
      : PROMPT_SYSTEM;
    const target = provider === 'antigravity' ? antigravity : gemini;
    const defaultModel = provider === 'antigravity'
      ? getSetting('antigravityTextModel') : getSetting('geminiTextModel');
    const out = await target.generateText({
      model: model || defaultModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.8,
    });
    res.json({ ...out, provider: provider === 'antigravity' ? 'antigravity' : 'gemini' });
  } catch (error) {
    res.status(error.status || 502).json({ error: `生成提示词失败：${error.message}` });
  }
});

export default r;
