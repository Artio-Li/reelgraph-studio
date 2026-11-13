import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from './config.js';
import { getSetting, getSecretSetting } from './db.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MODEL_CACHE_MS = 10 * 60 * 1000;
let modelCache = null;
let modelCacheAt = 0;

export const FALLBACK_TEXT_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', kind: 'text' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', kind: 'text' },
];

export const FALLBACK_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image', kind: 'image' },
  { id: 'gemini-3.1-flash-lite-image', name: 'Gemini 3.1 Flash Lite Image', kind: 'image' },
  { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image', kind: 'image' },
];

export function isEnabled() {
  return getSetting('geminiEnabled') === '1' && !!getSecretSetting('geminiApiKey');
}

function apiKey() {
  const key = getSecretSetting('geminiApiKey');
  if (!key) throw Object.assign(new Error('管理员还没有配置 Gemini API Key'), { status: 503 });
  if (getSetting('geminiEnabled') !== '1') throw Object.assign(new Error('Gemini 服务尚未启用'), { status: 503 });
  return key;
}

async function request(endpoint, options = {}, timeoutMs = 5 * 60 * 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'x-goog-api-key': apiKey(),
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const message = data?.error?.message || data?.message || `Gemini HTTP ${response.status}`;
      throw Object.assign(new Error(message), { status: response.status, data });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Gemini 请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels({ force = false } = {}) {
  if (!force && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
  const data = await request('/models?pageSize=1000', { method: 'GET' }, 30_000);
  const rows = Array.isArray(data.models) ? data.models : [];
  const models = rows.map((item) => {
    const id = String(item.name || '').replace(/^models\//, '');
    const label = item.displayName || id;
    const methods = item.supportedGenerationMethods || [];
    const image = /image|nano.banana/i.test(`${id} ${label}`);
    return { id, name: label, kind: image ? 'image' : 'text', methods };
  }).filter((item) => item.id && item.methods.includes('generateContent'));
  modelCache = {
    text: models.filter((item) => item.kind === 'text'),
    image: models.filter((item) => item.kind === 'image'),
  };
  modelCacheAt = Date.now();
  return modelCache;
}

function normalizeMessages(messages) {
  let system = '';
  const contents = [];
  for (const item of messages || []) {
    if (!item || typeof item.content !== 'string') continue;
    if (item.role === 'system') {
      system += `${system ? '\n\n' : ''}${item.content}`;
      continue;
    }
    if (!['user', 'assistant', 'model'].includes(item.role)) continue;
    contents.push({
      role: item.role === 'assistant' ? 'model' : item.role,
      parts: [{ text: item.content.slice(0, 30000) }],
    });
  }
  return { system, contents };
}

export async function generateText({ messages, model, temperature = 0.75, maxOutputTokens = 8192 }) {
  const selected = model || getSetting('geminiTextModel') || FALLBACK_TEXT_MODELS[0].id;
  const { system, contents } = normalizeMessages(messages);
  if (!contents.length) throw new Error('Gemini 文本请求缺少用户内容');
  const payload = {
    contents,
    generationConfig: { temperature, maxOutputTokens },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const data = await request(`/models/${encodeURIComponent(selected)}:generateContent`, {
    method: 'POST', body: JSON.stringify(payload),
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const content = parts.map((part) => part.text || '').filter(Boolean).join('\n').trim();
  if (!content) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || '空响应';
    throw new Error(`Gemini 未返回文本：${reason}`);
  }
  return { content, model: selected, usage: data.usageMetadata || null };
}

function parseDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

async function imagePart(source) {
  const value = typeof source === 'string' ? source : source?.url;
  const inline = parseDataUrl(value);
  if (inline) return { inlineData: inline };
  if (!/^https?:\/\//i.test(String(value || ''))) throw new Error('Gemini 参考图格式无效');
  const response = await fetch(value);
  if (!response.ok) throw new Error(`参考图下载失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error('单张参考图不能超过 20MB');
  return {
    inlineData: {
      mimeType: response.headers.get('content-type') || 'image/jpeg',
      data: bytes.toString('base64'),
    },
  };
}

export async function analyzeImages({ prompt, images = [], model }) {
  const selected = model || getSetting('geminiTextModel') || FALLBACK_TEXT_MODELS[0].id;
  const parts = [{ text: String(prompt || '').trim() }];
  for (const image of images.slice(0, 12)) parts.push(await imagePart(image));
  const data = await request(`/models/${encodeURIComponent(selected)}:generateContent`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    }),
  });
  const content = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '').filter(Boolean).join('\n').trim();
  if (!content) throw new Error('Gemini 视觉质检未返回结果');
  return { content, model: selected, usage: data.usageMetadata || null };
}

function imageExtension(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  return '.png';
}

export async function generateImage({ prompt, model, size = '1:1', resolution = '1K', images = [], jobId }) {
  const selected = model || getSetting('geminiImageModel') || FALLBACK_IMAGE_MODELS[0].id;
  const parts = [{ text: String(prompt).trim() }];
  for (const image of images.slice(0, 14)) parts.push(await imagePart(image));
  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: size, imageSize: resolution },
    },
  };
  const data = await request(`/models/${encodeURIComponent(selected)}:generateContent`, {
    method: 'POST', body: JSON.stringify(payload),
  }, 10 * 60 * 1000);
  const outputParts = data?.candidates?.[0]?.content?.parts || [];
  const image = outputParts.map((part) => part.inlineData || part.inline_data).find((part) => part?.data);
  const note = outputParts.map((part) => part.text || '').filter(Boolean).join('\n').trim();
  if (!image) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || note || '空响应';
    throw new Error(`Gemini 未返回图片：${reason}`);
  }
  const bytes = Buffer.from(image.data, 'base64');
  const fileName = `${jobId || `gemini_${Date.now()}`}${imageExtension(image.mimeType || image.mime_type)}`;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), bytes);
  return {
    fileName,
    bytes: bytes.length,
    mime: image.mimeType || image.mime_type || 'image/png',
    note,
    model: selected,
    usage: data.usageMetadata || null,
    url: `/media/${fileName}`,
  };
}
