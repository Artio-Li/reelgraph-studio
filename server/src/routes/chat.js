import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { CFG } from '../config.js';

const r = Router();

export const TEXT_MODELS = [
  { id: 'muse-spark', name: 'Muse Spark', desc: '内置文本模型，响应快' },
];

/** 站内文本对话：用 JWT 鉴权，转发到上游的 OpenAI 兼容接口 */
r.post('/chat', requireAuth, async (req, res) => {
  const { messages, model = 'muse-spark' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: '请先选择文本模型' });
  }

  const clean = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);

  try {
    const up = await fetch(`${CFG.museBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages: clean, stream: false }),
      signal: controller.signal,
    });

    const text = await up.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!up.ok) {
      return res.status(up.status).json({ error: data?.error?.message || data?.detail || `上游 HTTP ${up.status}` });
    }

    const content = data?.choices?.[0]?.message?.content ?? '';
    res.json({ content, model, usage: data?.usage || null });
  } catch (e) {
    res.status(502).json({ error: `请求异常：${e.message}` });
  } finally {
    clearTimeout(timer);
  }
});

r.get('/chat/models', requireAuth, (_req, res) => res.json({ models: TEXT_MODELS }));

export default r;
