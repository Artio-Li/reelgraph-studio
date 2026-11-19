import * as muse from './muse.js';
import { getSetting, getSecretSetting } from './db.js';

export const VIDEO_ENGINES = [
  {
    id: 'muse-video',
    name: 'Muse Video (账号池引擎)',
    provider: 'muse',
    durations: [5, 6, 8, 10],
    sizes: ['16:9', '9:16', '1:1'],
  },
];

/**
 * 将用户常误写的 @图1 / @[Image 1] / @Image1 规范化为【图1】，
 * 防止上游多模态聊天路由因找不到 @ 附件名而停下来纯文本反问。
 */
export function sanitizeVideoPrompt(prompt) {
  const raw = String(prompt || '');
  if (!raw) return raw;
  return raw
    .replace(/@\[\s*(?:image|img|图|参考图)\s*[-_#]?\s*(\d+)\s*\]/gi, '【图$1】')
    .replace(/@(?:image|img|图|参考图)\s*[-_#]?\s*(\d+)/gi, '【图$1】')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * 识别上游“未生成视频、仅返回对话反问或合规拒答”错误，提取纯文本反馈用于自动改词重投。
 */
export function extractRefusalFeedback(errorMessage) {
  const msg = String(errorMessage || '').trim();
  if (!msg) return null;
  const markers = [
    /模型未生成媒体[，,:\s]*仅返回文本[:：]?\s*([\s\S]+)/i,
    /未生成视频[，,:\s]*仅返回文本[:：]?\s*([\s\S]+)/i,
    /only returned text[:：]?\s*([\s\S]+)/i,
  ];
  for (const re of markers) {
    const m = msg.match(re);
    if (m?.[1]) return m[1].trim().slice(0, 600);
  }
  if (/没能做出来|不能直接生成|没有收到任何图片|换个方向帮你做/.test(msg)) {
    return msg.slice(0, 600);
  }
  return null;
}

/** 统一列出当前可用视频模型（含可选的外部异步视频 Provider 扩展） */
export function listVideoEngines() {
  const list = [...VIDEO_ENGINES];
  if (getSetting('externalVideoEnabled') === '1' && getSetting('externalVideoBaseUrl')) {
    list.push({
      id: getSetting('externalVideoModel') || 'external-video',
      name: getSetting('externalVideoName') || '外部视频 API',
      provider: 'external',
      durations: [5, 6, 8, 10],
      sizes: ['16:9', '9:16', '1:1'],
    });
  }
  return list;
}

async function callExternalVideo(pathname, { method = 'GET', body, timeout = 120_000 } = {}) {
  const base = String(getSetting('externalVideoBaseUrl') || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  const key = getSecretSetting('externalVideoApiKey');
  if (!base) throw new Error('外部视频 API 地址未配置');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(`${base}/v1${pathname}`, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `外部视频 HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一提交视频生成任务 */
export async function submitVideoTask(payload = {}) {
  const next = {
    ...payload,
    prompt: sanitizeVideoPrompt(payload.prompt),
  };
  if (next.provider === 'external' || (next.model && next.model !== 'muse-video' && getSetting('externalVideoEnabled') === '1')) {
    return callExternalVideo('/videos', { method: 'POST', body: next });
  }
  return muse.createVideo(next);
}

/** 统一轮询视频生成任务 */
export async function pollVideoTask(upstreamId, provider = 'muse') {
  if (provider === 'external') {
    return callExternalVideo(`/videos/${encodeURIComponent(upstreamId)}`);
  }
  return muse.getVideo(upstreamId);
}
