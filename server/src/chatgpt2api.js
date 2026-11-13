import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from './config.js';
import { getSetting, getSecretSetting } from './db.js';

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MODEL_CACHE_MS = 10 * 60 * 1000;
let modelCache = null;
let modelCacheAt = 0;

export const FALLBACK_TEXT_MODELS = [
  { id: 'gpt-5-6-mini', name: 'GPT 5.6 Mini', kind: 'text' },
  { id: 'gpt-5-6', name: 'GPT 5.6', kind: 'text' },
];

export const FALLBACK_IMAGE_MODELS = [
  { id: 'gpt-image-2', name: 'GPT Image 2', kind: 'image' },
];

export function normalizeBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw Object.assign(new Error('管理员还没有配置 ChatGPT2API 服务地址'), { status: 503 });
  let url;
  try { url = new URL(raw); } catch {
    throw Object.assign(new Error('ChatGPT2API 服务地址格式无效'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('ChatGPT2API 服务地址只支持 HTTP 或 HTTPS'), { status: 400 });
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '') || '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function isEnabled() {
  return getSetting('chatgpt2apiEnabled') === '1'
    && !!getSetting('chatgpt2apiBaseUrl')
    && !!getSecretSetting('chatgpt2apiApiKey');
}

function credentials() {
  const key = getSecretSetting('chatgpt2apiApiKey');
  if (!key) throw Object.assign(new Error('管理员还没有配置 ChatGPT2API API Key'), { status: 503 });
  if (getSetting('chatgpt2apiEnabled') !== '1') {
    throw Object.assign(new Error('ChatGPT2API Provider 尚未启用'), { status: 503 });
  }
  return { key, base: normalizeBaseUrl(getSetting('chatgpt2apiBaseUrl')) };
}

async function request(endpoint, options = {}, timeoutMs = 10 * 60 * 1000) {
  const { key, base } = credentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/v1${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.detail?.error
        || data?.detail || data?.message || `HTTP ${response.status}`;
      throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), {
        status: response.status, data,
      });
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('ChatGPT2API 请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels({ force = false } = {}) {
  if (!force && modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
  const data = await request('/models', { method: 'GET' }, 30_000);
  const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const models = rows.map((item) => {
    const id = String(item?.id || item?.name || '').replace(/^models\//, '');
    const name = String(item?.display_name || item?.displayName || item?.name || id);
    const kind = /image|dall[.-]?e/i.test(`${id} ${name}`) ? 'image' : 'text';
    return { id, name, kind };
  }).filter((item) => item.id);
  modelCache = {
    text: models.filter((item) => item.kind === 'text'),
    image: models.filter((item) => item.kind === 'image'),
  };
  if (!modelCache.text.length) modelCache.text = FALLBACK_TEXT_MODELS;
  if (!modelCache.image.length) modelCache.image = FALLBACK_IMAGE_MODELS;
  modelCacheAt = Date.now();
  return modelCache;
}

function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((part) => typeof part === 'string' ? part : part?.text || '')
    .filter(Boolean).join('\n').trim();
}

export async function generateText({ messages, model, temperature = 0.75, maxOutputTokens = 8192 }) {
  const selected = model || getSetting('chatgpt2apiTextModel') || FALLBACK_TEXT_MODELS[0].id;
  const clean = (messages || [])
    .filter((item) => item && ['system', 'user', 'assistant'].includes(item.role))
    .map((item) => ({ role: item.role, content: String(item.content || '').slice(0, 30000) }))
    .filter((item) => item.content);
  if (!clean.length) throw new Error('ChatGPT2API 文本请求缺少用户内容');
  const data = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: selected,
      messages: clean,
      temperature,
      max_tokens: maxOutputTokens,
      stream: false,
    }),
  }, 5 * 60 * 1000);
  const content = contentText(data?.choices?.[0]?.message?.content);
  if (!content) throw new Error('ChatGPT2API 未返回文本内容');
  return { content, model: data?.model || selected, usage: data?.usage || null };
}

function parseDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,(.+)$/s);
  return match ? { mime: match[1], data: match[2] } : null;
}

function imageExtension(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function detectMime(bytes, fallback = 'image/png') {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return fallback;
}

async function sourceToDataUrl(source) {
  const value = typeof source === 'string' ? source : source?.url;
  const inline = parseDataUrl(value);
  if (inline) return String(value);
  if (!/^https?:\/\//i.test(String(value || ''))) throw new Error('ChatGPT2API 参考图格式无效');
  const response = await fetch(value, { headers: { Accept: 'image/*,*/*;q=0.8' } });
  if (!response.ok) throw new Error(`参考图下载失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('参考图内容为空');
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error('单张参考图不能超过 20MB');
  const mime = response.headers.get('content-type') || detectMime(bytes);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export async function analyzeImages({ prompt, images = [], model }) {
  const selected = model || getSetting('chatgpt2apiTextModel') || FALLBACK_TEXT_MODELS[0].id;
  const content = [{ type: 'text', text: String(prompt || '').trim() }];
  for (const image of images.slice(0, 12)) {
    content.push({ type: 'image_url', image_url: { url: await sourceToDataUrl(image) } });
  }
  const data = await request('/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: selected, messages: [{ role: 'user', content }], temperature: 0.1,
      max_tokens: 2048, response_format: { type: 'json_object' }, stream: false,
    }),
  });
  const result = contentText(data?.choices?.[0]?.message?.content);
  if (!result) throw new Error('ChatGPT2API 视觉质检未返回结果');
  return { content: result, model: data?.model || selected, usage: data?.usage || null };
}

function sizePixels(size) {
  if (['9:16', '3:4'].includes(size)) return '1024x1536';
  if (['16:9', '4:3'].includes(size)) return '1536x1024';
  return '1024x1024';
}

function qualityOf(resolution) {
  if (resolution === '4K') return 'high';
  if (resolution === '2K') return 'medium';
  return 'low';
}

async function imageBytes(value) {
  const inline = parseDataUrl(value);
  if (inline) {
    const bytes = Buffer.from(inline.data, 'base64');
    return { bytes, mime: detectMime(bytes, inline.mime) };
  }
  if (typeof value === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
    const bytes = Buffer.from(value.replace(/\s/g, ''), 'base64');
    return { bytes, mime: detectMime(bytes) };
  }
  if (/^https?:\/\//i.test(String(value || ''))) {
    const { key, base } = credentials();
    const target = new URL(value);
    const headers = target.origin === new URL(base).origin ? { Authorization: `Bearer ${key}` } : {};
    const response = await fetch(value, { headers });
    if (!response.ok) throw new Error(`ChatGPT2API 图片下载失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, mime: detectMime(bytes, response.headers.get('content-type') || 'image/png') };
  }
  throw new Error('ChatGPT2API 返回了无法识别的图片格式');
}

export async function generateImage({ prompt, model, size = '1:1', resolution = '1K', images = [], jobId }) {
  const selected = model || getSetting('chatgpt2apiImageModel') || FALLBACK_IMAGE_MODELS[0].id;
  const basePayload = {
    model: selected,
    prompt: String(prompt).trim(),
    n: 1,
    size: sizePixels(size),
    quality: qualityOf(resolution),
    response_format: 'b64_json',
  };
  let data;
  if (images.length) {
    const refs = [];
    for (const image of images.slice(0, 4)) refs.push(await sourceToDataUrl(image));
    data = await request('/images/edits', {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, images: refs }),
    });
  } else {
    data = await request('/images/generations', {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, history_disabled: true }),
    });
  }
  const image = data?.data?.[0] || {};
  const value = image.b64_json || image.url;
  const note = String(image.revised_prompt || data?.revised_prompt || '').slice(0, 4000);
  if (!value) throw new Error(`ChatGPT2API 未返回图片${note ? `：${note}` : ''}`);
  const output = await imageBytes(value);
  const fileName = `${jobId || `chatgpt2api_${Date.now()}`}${imageExtension(output.mime)}`;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), output.bytes);
  return {
    fileName,
    bytes: output.bytes.length,
    mime: output.mime,
    note,
    model: data?.model || selected,
    usage: data?.usage || null,
    url: `/media/${fileName}`,
  };
}
