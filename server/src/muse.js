import fs from 'node:fs';
import path from 'node:path';
import { CFG, MEDIA_DIR } from './config.js';

class MuseError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'MuseError';
    this.status = status;
    this.body = body;
  }
}

async function call(pathname, { method = 'GET', body, raw = false, timeout = 120_000 } = {}) {
  const url = `${CFG.museBase}${pathname}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    if (raw) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = (data && (data.message || data.detail || data.error)) || `上游 HTTP ${res.status}`;
      throw new MuseError(typeof msg === 'string' ? msg : JSON.stringify(msg), res.status, data);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new MuseError('上游请求超时', 504);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- 健康 / 概览 --------------------------- */
export const health = () => call('/healthz', { timeout: 8000 });
export const status = () => call('/admin/status', { timeout: 20_000 });

/* ----------------------------- 账号池 ----------------------------- */
export async function listAccounts() {
  const data = await call('/admin/accounts');
  return { accounts: data?.accounts || [], stats: data?.stats || {} };
}

export async function addAccount({ label, cookie, expires, proxy }) {
  const body = { label };
  if (cookie) body.cookie_header = cookie;
  if (expires) body.expires = expires;
  if (proxy) body.proxy = proxy;
  return call('/admin/accounts', { method: 'POST', body });
}

export async function startCredentialImport(payload) {
  return call('/admin/credential-imports', { method: 'POST', body: payload, timeout: 20_000 });
}

export async function credentialImportStatus(jobId) {
  return call(`/admin/credential-imports/${encodeURIComponent(jobId)}`, { timeout: 10_000 });
}

export async function submitCredentialCode(jobId, index, code) {
  return call(`/admin/credential-imports/${encodeURIComponent(jobId)}/code`, {
    method: 'POST', body: { index, code }, timeout: 10_000,
  });
}

export async function deleteAccount(upstreamId) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}`, { method: 'DELETE' });
}

export async function testAccount(upstreamId) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}/test`, { method: 'POST', timeout: 180_000 });
}

export async function reloginAccount(upstreamId) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}/relogin`, { method: 'POST', timeout: 180_000 });
}

export async function keepaliveAccount(upstreamId) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}/keepalive`, { method: 'POST', timeout: 180_000 });
}

export async function patchAccount(upstreamId, payload) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}`, {
    method: 'PATCH', body: payload, timeout: 20_000,
  });
}

export async function testAccountProxy(upstreamId, proxy) {
  return call(`/admin/accounts/${encodeURIComponent(upstreamId)}/proxy/test`, {
    method: 'POST', body: { proxy }, timeout: 60_000,
  });
}

/** 查询额度：不传 id 查全池（用最久未用的账号），传 id 查指定账号 */
export async function queryQuota(upstreamId) {
  if (upstreamId) {
    return call(`/admin/accounts/${encodeURIComponent(upstreamId)}/quota`, { method: 'POST', timeout: 150_000 });
  }
  return call('/admin/quota', { method: 'POST', timeout: 150_000 });
}

/* ------------------------------ 视频 ------------------------------ */
export async function createVideo(payload) {
  return call('/v1/videos', { method: 'POST', body: payload, timeout: 120_000 });
}

export async function getVideo(id) {
  return call(`/v1/videos/${encodeURIComponent(id)}`);
}

/* ------------------------------ 图片 ------------------------------ */
export async function createImage(payload) {
  return call('/v1/images/generations', { method: 'POST', body: payload, timeout: 300_000 });
}

export async function createImageTask(payload) {
  return call('/v1/images/tasks', { method: 'POST', body: payload, timeout: 60_000 });
}

export async function getImageTask(id) {
  return call(`/v1/images/tasks/${encodeURIComponent(id)}`);
}

/* ------------------------------ 媒体 ------------------------------ */
const EXT_BY_KIND = { image: '.webp', video: '.mp4', audio: '.mp3' };

export function extOf(name = '', kind = 'video') {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? `.${m[1].toLowerCase()}` : EXT_BY_KIND[kind] || '.bin';
}

/**
 * 把上游媒体下载到本地 media 目录，返回本地文件名。
 * 上游重启或清理后仍可回放，这是作品库不丢的前提。
 */
export async function downloadMedia(mediaPathOrUrl, jobId, kind = 'video', timeout = 300_000) {
  let pathname = mediaPathOrUrl;
  if (/^https?:\/\//i.test(pathname)) {
    const u = new URL(pathname);
    pathname = u.pathname + u.search;
  }
  const res = await call(pathname, { raw: true, timeout });
  if (!res.ok) throw new MuseError(`媒体下载失败 HTTP ${res.status}`, res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const fileName = `${jobId}${extOf(pathname, kind)}`;
  const dest = path.join(MEDIA_DIR, fileName);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  return { fileName, bytes: buf.length };
}

export { MuseError };
