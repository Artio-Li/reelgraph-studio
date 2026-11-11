import { Router } from 'express';
import { CFG } from '../config.js';
import { apiKeyAuth } from './apikeys.js';

/**
 * 对外暴露 OpenAI 兼容接口 /v1/*，用平台的 sk- 密钥鉴权，
 * 内部转发到上游 muse2api（它才是真正驱动 muse.ai 的那层）。
 */
const r = Router();

r.use(apiKeyAuth);

r.all('/*', async (req, res) => {
  const target = CFG.museBase + req.originalUrl; // originalUrl 已含 /v1/... 与 query
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const up = await fetch(target, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: controller.signal,
    });

    const ct = up.headers.get('content-type') || 'application/json';
    res.status(up.status).set('Content-Type', ct);

    // SSE 流式直接透传
    if (ct.includes('text/event-stream') && up.body) {
      const reader = up.body.getReader();
      res.flushHeaders?.();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
      return;
    }

    const buf = Buffer.from(await up.arrayBuffer());
    res.send(buf);
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({
        error: { message: `上游不可用：${e.message}`, type: 'upstream_error' },
      });
    }
  } finally {
    clearTimeout(timer);
  }
});

export default r;
