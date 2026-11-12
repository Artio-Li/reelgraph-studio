import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getSetting } from '../db.js';
import * as gemini from '../gemini.js';
import * as antigravity from '../antigravity.js';
import * as chatgpt2api from '../chatgpt2api.js';
import { realismEnabled, REALISM_GENERATOR_RULES } from '../realism.js';

const r = Router();

const PROMPT_SYSTEM = `你是 ReelGraph Studio 的专业 AI 视频提示词导演。用户会提供关键词、可选模板和规格。
你的任务是补全人物、服装、场景、光线、机位、逐秒动作、风格、音频、参数和负面提示词。
输出必须是可直接复制给视频生成模型的完整中文提示词，不要解释创作过程，不要使用 Markdown 代码块。
优先保证人物一致性、动作可执行性、真实手机或摄影机物理表现，避免在短时长内塞入无法完成的动作。`;

r.get('/gemini/meta', requireAuth, async (_req, res) => {
  const officialEnabled = gemini.isEnabled();
  const antigravityEnabled = antigravity.isEnabled();
  const chatgpt2apiEnabled = chatgpt2api.isEnabled();
  let officialModels = { text: gemini.FALLBACK_TEXT_MODELS, image: gemini.FALLBACK_IMAGE_MODELS };
  let antigravityModels = { text: antigravity.FALLBACK_TEXT_MODELS, image: antigravity.FALLBACK_IMAGE_MODELS };
  let chatgpt2apiModels = { text: chatgpt2api.FALLBACK_TEXT_MODELS, image: chatgpt2api.FALLBACK_IMAGE_MODELS };
  if (officialEnabled) try { officialModels = await gemini.listModels(); } catch { /* 使用兜底列表 */ }
  if (antigravityEnabled) try { antigravityModels = await antigravity.listModels(); } catch { /* 使用兜底列表 */ }
  if (chatgpt2apiEnabled) try { chatgpt2apiModels = await chatgpt2api.listModels(); } catch { /* 使用兜底列表 */ }
  const defaultProvider = officialEnabled ? 'gemini'
    : antigravityEnabled ? 'antigravity'
      : chatgpt2apiEnabled ? 'chatgpt2api' : 'gemini';
  const defaultModels = defaultProvider === 'gemini' ? officialModels
    : defaultProvider === 'antigravity' ? antigravityModels : chatgpt2apiModels;
  const defaultTextModel = defaultProvider === 'gemini' ? getSetting('geminiTextModel')
    : defaultProvider === 'antigravity' ? getSetting('antigravityTextModel')
      : getSetting('chatgpt2apiTextModel');
  const defaultImageModel = defaultProvider === 'gemini' ? getSetting('geminiImageModel')
    : defaultProvider === 'antigravity' ? getSetting('antigravityImageModel')
      : getSetting('chatgpt2apiImageModel');
  res.json({
    enabled: officialEnabled || antigravityEnabled || chatgpt2apiEnabled,
    realismEnabled: realismEnabled(),
    models: defaultModels,
    defaults: { text: defaultTextModel, image: defaultImageModel },
    defaultProvider,
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
      chatgpt2api: {
        id: 'chatgpt2api', name: 'ChatGPT2API', enabled: chatgpt2apiEnabled,
        models: chatgpt2apiModels,
        defaults: { text: getSetting('chatgpt2apiTextModel'), image: getSetting('chatgpt2apiImageModel') },
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
    const providers = {
      gemini: { target: gemini, defaultModel: getSetting('geminiTextModel') },
      antigravity: { target: antigravity, defaultModel: getSetting('antigravityTextModel') },
      chatgpt2api: { target: chatgpt2api, defaultModel: getSetting('chatgpt2apiTextModel') },
    };
    const selected = providers[provider] || providers.gemini;
    if (!selected.target.isEnabled()) throw Object.assign(new Error('当前 AI Provider 尚未启用'), { status: 503 });
    const out = await selected.target.generateText({
      model: model || selected.defaultModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.8,
    });
    res.json({ ...out, provider: providers[provider] ? provider : 'gemini' });
  } catch (error) {
    res.status(error.status || 502).json({ error: `生成提示词失败：${error.message}` });
  }
});

export default r;
