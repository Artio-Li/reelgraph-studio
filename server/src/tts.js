import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, getSecretSetting } from './db.js';
import { normalizeBaseUrl as normalizeChatgptBase } from './chatgpt2api.js';

export const VOICE_PRESETS = [
  { id: 'xiaoxiao', label: '晓晓 · 温暖叙事女声', edgeVoice: 'zh-CN-XiaoxiaoNeural', openaiVoice: 'nova', lang: 'zh-CN' },
  { id: 'yunxi', label: '云希 · 清朗青年男声', edgeVoice: 'zh-CN-YunxiNeural', openaiVoice: 'echo', lang: 'zh-CN' },
  { id: 'yunjian', label: '云健 · 沉稳电影旁白', edgeVoice: 'zh-CN-YunjianNeural', openaiVoice: 'onyx', lang: 'zh-CN' },
  { id: 'xiaoyi', label: '晓伊 · 灵动口播少女', edgeVoice: 'zh-CN-XiaoyiNeural', openaiVoice: 'shimmer', lang: 'zh-CN' },
];

export function getVoicePreset(id) {
  return VOICE_PRESETS.find((v) => v.id === id) || VOICE_PRESETS[0];
}

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;

function generateSecMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  const strToHash = `${(ticks * 1e7).toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 方案 1：Microsoft Edge Neural TTS (免密钥高质量神经网络配音) */
async function synthesizeWithEdge(text, voiceName, timeoutMs = 20_000) {
  if (typeof WebSocket === 'undefined') throw new Error('当前运行时不支持 WebSocket');
  const reqId = crypto.randomUUID().replace(/-/g, '');
  const gec = generateSecMsGec();
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${reqId}`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(buf);
    };

    let ws;
    try {
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      return reject(err);
    }

    const timer = setTimeout(() => finish(new Error('Edge TTS 连接超时')), timeoutMs);

    ws.addEventListener('open', () => {
      const configMsg = [
        `X-Timestamp:${new Date().toISOString()}`,
        'Content-Type:application/json; charset=utf-8',
        'Path:speech.config\r\n',
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        }),
      ].join('\r\n');
      ws.send(configMsg);

      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${voiceName}'><prosody pitch='+0Hz' rate='+4%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
      const ssmlMsg = [
        `X-RequestId:${reqId}`,
        'Content-Type:application/ssml+xml',
        `X-Timestamp:${new Date().toISOString()}Z`,
        'Path:ssml\r\n',
        ssml,
      ].join('\r\n');
      ws.send(ssmlMsg);
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) {
          const merged = Buffer.concat(chunks);
          if (!merged.length) return finish(new Error('Edge TTS 未返回音频数据'));
          finish(null, merged);
        }
        return;
      }
      const buf = Buffer.from(event.data);
      if (buf.length < 2) return;
      const headerLen = buf.readUInt16BE(0);
      if (buf.length > 2 + headerLen) {
        const header = buf.subarray(2, 2 + headerLen).toString('utf8');
        if (header.includes('Path:audio')) {
          chunks.push(buf.subarray(2 + headerLen));
        }
      }
    });

    ws.addEventListener('error', () => finish(new Error('Edge TTS WebSocket 异常')));
    ws.addEventListener('close', () => {
      if (!settled) {
        const merged = Buffer.concat(chunks);
        if (merged.length > 256) finish(null, merged);
        else finish(new Error('Edge TTS 连接提前关闭'));
      }
    });
  });
}

/** 方案 2：OpenAI 兼容 /v1/audio/speech（若已配置 ChatGPT2API 支持语音端点） */
async function synthesizeWithOpenAICompat(text, openaiVoice, timeoutMs = 25_000) {
  if (getSetting('chatgpt2apiEnabled') !== '1') throw new Error('ChatGPT2API 未启用');
  const key = getSecretSetting('chatgpt2apiApiKey');
  const rawBase = getSetting('chatgpt2apiBaseUrl');
  if (!key || !rawBase) throw new Error('缺少 ChatGPT2API 凭据');
  const base = normalizeChatgptBase(rawBase);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: openaiVoice || 'nova',
        response_format: 'mp3',
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 256) throw new Error('OpenAI TTS 响应过短');
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

/** 方案 3：Google Translate TTS 兜底（保证机房网络受限时依然能稳定产出中文 MP3） */
async function synthesizeWithGoogleFallback(text, lang = 'zh-CN', timeoutMs = 15_000) {
  const clean = String(text || '').trim().slice(0, 180);
  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(clean)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Fallback TTS HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 256) throw new Error('Fallback TTS 响应为空');
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 合成单段旁白 MP3 文件，自动按 Edge Neural -> Google TTS -> OpenAI TTS 多级容灾。
 */
export async function synthesizeNarrationToFile(text, outputFile, { voiceId = 'xiaoxiao' } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
  if (!clean) return null;
  const preset = getVoicePreset(voiceId);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const attempts = [
    () => synthesizeWithEdge(clean, preset.edgeVoice),
    () => synthesizeWithGoogleFallback(clean, preset.lang),
    () => synthesizeWithOpenAICompat(clean, preset.openaiVoice),
  ];

  let lastErr = null;
  for (const fn of attempts) {
    try {
      const buf = await fn();
      if (buf && buf.length > 256) {
        fs.writeFileSync(outputFile, buf);
        return { file: outputFile, bytes: buf.length, voiceId: preset.id };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`旁白配音合成失败：${lastErr?.message || '所有 TTS 通道不可用'}`);
}
