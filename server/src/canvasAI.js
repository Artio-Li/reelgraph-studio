import { getSetting } from './db.js';
import * as gemini from './gemini.js';
import * as antigravity from './antigravity.js';
import * as chatgpt2api from './chatgpt2api.js';
import { realismEnabled, REALISM_GENERATOR_RULES } from './realism.js';

const PROMPT_SYSTEM = `你是 ReelGraph Studio 的专业 AI 视频提示词导演。用户会提供关键词、可选模板和规格。
你的任务是补全人物、服装、场景、光线、机位、逐秒动作、风格、音频、参数和负面提示词。
输出必须是可直接复制给视频生成模型的完整中文提示词，不要解释创作过程，不要使用 Markdown 代码块。
优先保证人物一致性、动作可执行性、真实手机或摄影机物理表现，避免在短时长内塞入无法完成的动作。`;

const PROVIDERS = {
  gemini: {
    target: gemini,
    textSetting: 'geminiTextModel',
    imageSetting: 'geminiImageModel',
  },
  antigravity: {
    target: antigravity,
    textSetting: 'antigravityTextModel',
    imageSetting: 'antigravityImageModel',
  },
  chatgpt2api: {
    target: chatgpt2api,
    textSetting: 'chatgpt2apiTextModel',
    imageSetting: 'chatgpt2apiImageModel',
  },
};

export function canvasProvider(provider = 'gemini') {
  const id = PROVIDERS[provider] ? provider : 'gemini';
  const selected = PROVIDERS[id];
  if (!selected.target.isEnabled()) {
    throw Object.assign(new Error(`当前 AI Provider（${id}）尚未启用`), { status: 503 });
  }
  return { id, ...selected };
}

export async function generateCanvasPrompt({
  keywords, template = '', purpose = '视频提示词', duration = 10,
  aspectRatio = '9:16', style = '写实真人质感', model, provider = 'gemini',
}) {
  const demand = String(keywords || '').trim();
  if (demand.length < 2) throw new Error('AI 提示词节点缺少关键词或需求');
  const selected = canvasProvider(provider);
  const user = [
    `目标：${String(purpose).slice(0, 100)}`,
    `关键词/需求：${demand.slice(0, 12000)}`,
    `时长：${Number(duration) || 10} 秒`,
    `画幅：${String(aspectRatio).slice(0, 20)}`,
    `风格：${String(style).slice(0, 500)}`,
    template ? `参考模板（学习其结构和专业度，不要机械照抄内容）：\n${String(template).slice(0, 30000)}` : '',
    '请直接给出最终完整提示词。',
  ].filter(Boolean).join('\n\n');
  const system = realismEnabled()
    ? `${PROMPT_SYSTEM}\n\n${REALISM_GENERATOR_RULES}`
    : PROMPT_SYSTEM;
  const out = await selected.target.generateText({
    model: model || getSetting(selected.textSetting),
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.8,
  });
  return { ...out, provider: selected.id };
}

export async function generateCanvasImage({
  prompt, images = [], model, provider = 'gemini', size = '9:16', resolution = '1K', jobId,
}) {
  const selected = canvasProvider(provider);
  return selected.target.generateImage({
    prompt,
    images,
    model: model || getSetting(selected.imageSetting),
    size,
    resolution,
    jobId,
  });
}

function parseJsonObject(value) {
  const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(raw); } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('视觉质检返回格式无法解析');
    return JSON.parse(match[0]);
  }
}

export async function analyzeCanvasIdentity({ references = [], frames = [], provider = 'gemini', model = '' }) {
  if (!references.length || !frames.length) return null;
  const preferred = [provider, 'gemini', 'antigravity', 'chatgpt2api'];
  const prompt = `你是视频人物身份一致性质检器。前 ${references.length} 张图片是同一目标人物的身份参考，后 ${frames.length} 张图片是同一生成视频按时间顺序抽取的帧。
只比较可见人物的人脸身份，不因光线、妆容、角度、表情和轻微运动模糊误判。检查每一帧是否仍是参考人物，并判断视频内部是否发生换脸或身份漂移。
只输出 JSON，结构严格为：
{"faceSimilarity":0到100整数,"identityDrift":true或false,"frameScores":[0到100整数],"issues":["简短中文问题"],"summary":"简短中文结论"}
若某帧没有清晰人脸，不要凭空判断为不同人，应降低该帧置信度并在 issues 中说明。`;
  const candidates = [...new Set(preferred)].filter((candidate) => PROVIDERS[candidate]?.target?.isEnabled());
  if (!candidates.length) throw new Error('没有可用于人物相似度检测的视觉 Provider');
  let out;
  let id;
  let lastError;
  for (const candidate of candidates) {
    const selected = PROVIDERS[candidate];
    try {
      out = await selected.target.analyzeImages({
        prompt,
        images: [...references, ...frames],
        model: candidate === provider && model ? model : getSetting(selected.textSetting),
      });
      id = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!out) throw new Error(`视觉 Provider 均检测失败：${String(lastError?.message || lastError || '未知错误').slice(0, 180)}`);
  const parsed = parseJsonObject(out.content);
  const faceSimilarity = Math.max(0, Math.min(100, Math.round(Number(parsed.faceSimilarity) || 0)));
  return {
    faceSimilarity,
    identityDrift: parsed.identityDrift === true || faceSimilarity < 70,
    frameScores: Array.isArray(parsed.frameScores)
      ? parsed.frameScores.slice(0, frames.length).map((value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0))))
      : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 8) : [],
    summary: String(parsed.summary || '').slice(0, 300),
    provider: id,
    model: out.model,
  };
}

