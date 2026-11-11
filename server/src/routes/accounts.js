import { Router } from 'express';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  listAccounts as localAccounts, upsertAccount, deleteAccountRow, db, now,
  createBindCode, getBindCode, finishBindCode, failBindCode,
} from '../db.js';
import * as muse from '../muse.js';

const r = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validOtpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === '2fa.live'
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/tok\/[A-Z2-7]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function parseCredentialRows(mode, raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('请输入账号数据');
  if (Buffer.byteLength(raw, 'utf8') > 100 * 1024) throw new Error('导入内容不能超过 100KB');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('没有解析到账号');
  if (lines.length > 50) throw new Error('每批最多导入 50 个账号');
  const seen = new Set();
  const accounts = lines.map((line, index) => {
    if (mode === 'email_code') {
      if (!EMAIL_RE.test(line) || line.length > 254) throw new Error(`第 ${index + 1} 行邮箱格式不正确`);
      const key = line.toLowerCase();
      if (seen.has(key)) throw new Error(`第 ${index + 1} 行邮箱重复`);
      seen.add(key);
      return { email: line };
    }
    if (mode !== 'password_totp') throw new Error('不支持的导入方式');
    const parts = line.split(/-{3,}/);
    if (parts.length !== 3) {
      throw new Error(`第 ${index + 1} 行格式不正确，应为：邮箱----密码----2FA链接`);
    }
    const [email, password, otpUrl] = parts.map((part) => part.trim());
    if (!EMAIL_RE.test(email) || email.length > 254) throw new Error(`第 ${index + 1} 行邮箱格式不正确`);
    if (!password || password.length > 512) throw new Error(`第 ${index + 1} 行密码为空或过长`);
    if (!validOtpUrl(otpUrl)) throw new Error(`第 ${index + 1} 行 2FA 链接格式不正确`);
    const key = email.toLowerCase();
    if (seen.has(key)) throw new Error(`第 ${index + 1} 行邮箱重复`);
    seen.add(key);
    return { email, password, otp_url: otpUrl };
  });
  return accounts;
}

/* ---------------------------- 额度解析 ----------------------------
 * 上游 /admin/accounts 返回的 quota 形如：
 * { raw, weekly_reset: '11月11日', weekly_used_pct: 40, found: true, checked_at }
 * raw 里还带「已使用 0%(剩余 309 亿个词元)」这样的额外额度信息。
 */
function parseQuota(q) {
  if (!q || typeof q !== 'object') return null;
  if (!q.found && q.weekly_used_pct == null) return null;

  const raw = String(q.raw || '');
  const tokens = raw.match(/剩余\s*([\d.]+\s*[亿万]?)\s*个词元/);

  const usedPct = typeof q.weekly_used_pct === 'number' ? q.weekly_used_pct : null;
  return {
    weeklyUsedPct: usedPct,
    weeklyLeftPct: usedPct != null ? Math.max(0, Math.min(100, 100 - usedPct)) : null,
    weeklyReset: q.weekly_reset || null,
    tokensLeft: tokens ? tokens[1].replace(/\s+/g, '') : null,
    checkedAt: q.checked_at || null,
    ok: q.found === true,
  };
}

/* ---------------------------- 免 F12 绑定 ----------------------------
 * 流程：平台生成一次性 code → 浏览器扩展读 muse.ai 的 HttpOnly cookie
 *      → POST /api/accounts/bind（用 code 认证，不需要 JWT）→ 导入上游。
 */

// 生成绑定码（已登录用户在平台上点「一键绑定」）
r.post('/bind-code', requireAuth, (req, res) => {
  const { label } = req.body || {};
  const { code, expiresAt } = createBindCode(req.user.id, label);
  res.json({ code, expiresAt, url: `/bind/${code}` });
});

// 查询绑定状态（绑定页轮询用，公开读）
r.get('/bind/:code', (req, res) => {
  const row = getBindCode(req.params.code);
  if (!row) return res.status(404).json({ error: '绑定码不存在' });
  res.json({
    status: row.status,
    message: row.message || null,
    accountId: row.account_id || null,
    expiresAt: row.expires_at,
    label: row.label,
  });
});

// 扩展 / 油猴脚本提交 cookie（公开，用一次性 code 认证）
r.post('/bind', async (req, res) => {
  const { code, cookie, label } = req.body || {};
  if (!code) return res.status(400).json({ error: '缺少绑定码' });
  if (!cookie || String(cookie).trim().length < 10) {
    return res.status(400).json({ error: '没有收到 Cookie，请确认浏览器已登录 muse.ai' });
  }

  const row = getBindCode(code);
  if (!row) return res.status(404).json({ error: '绑定码不存在' });
  if (row.status === 'expired') return res.status(410).json({ error: '绑定码已过期，请在平台重新生成' });
  if (row.status === 'done') return res.status(409).json({ error: '该绑定码已使用过' });

  const cleaned = String(cookie).replace(/^cookie\s*:\s*/i, '').replace(/\s*\n\s*/g, '; ');
  if (!/hatch_sess=/.test(cleaned)) {
    const msg = 'Cookie 里没有 hatch_sess，这个浏览器可能没登录 muse.ai';
    failBindCode(code, msg);
    return res.status(400).json({ error: msg });
  }

  let result;
  try {
    result = await muse.addAccount({
      label: label || row.label || `muse-${new Date().toISOString().slice(5, 16)}`,
      cookie: cleaned,
    });
  } catch (e) {
    failBindCode(code, e.message);
    return res.status(502).json({ error: `上游拒绝导入：${e.message}` });
  }

  const added = (result.added || [])[0];
  if (!added) {
    const msg = '上游未返回账号信息';
    failBindCode(code, msg);
    return res.status(502).json({ error: msg });
  }

  const acc = upsertAccount({
    upstreamId: added.id,
    label: added.label,
    ownerId: row.user_id,
    status: 'unknown',
    expiresAt: added.expires_at || null,
  });

  finishBindCode(code, { accountId: acc.id, message: result.warning || '绑定成功' });

  res.json({
    ok: true,
    account: { id: acc.id, upstreamId: acc.upstream_id, label: acc.label },
    warning: result.warning || null,
  });
});

// 把上游账号池与本地镜像对齐（上游新增/删除时同步）
async function syncFromUpstream() {
  try {
    const { accounts } = await muse.listAccounts();
    for (const a of accounts) {
      upsertAccount({
        upstreamId: a.id,
        label: a.label,
        status: a.ok === true ? 'ok' : a.ok === false ? 'error' : 'unknown',
        expiresAt: a.expires_at || null,
        quota: a.quota ? JSON.stringify(a.quota) : null,
        note: a.note || null,
      });
    }
    return accounts;
  } catch (e) {
    return [];
  }
}

r.get('/', requireAuth, async (req, res) => {
  const upstream = await syncFromUpstream();
  const upMap = new Map(upstream.map((a) => [a.id, a]));
  const local = localAccounts(req.user.role === 'admin' ? null : req.user.id);

  const accounts = local.map((a) => {
    const up = a.upstream_id ? upMap.get(a.upstream_id) : null;
    let stored = null;
    try { stored = a.quota ? JSON.parse(a.quota) : null; } catch { stored = null; }
    const quota = parseQuota(up?.quota ?? stored);
    return {
      id: a.id,
      upstreamId: a.upstream_id,
      label: a.label,
      mine: a.owner_id === req.user.id,
      shared: a.owner_id === null,
      status: up ? (up.ok === true ? 'ok' : up.ok === false ? 'error' : 'unknown') : 'missing',
      note: up?.note || a.note || null,
      expiresAt: up?.expires_at ?? a.expires_at,
      quota,
      busy: !!up?.busy,
      proxy: up?.proxy || null,
      proxyStatus: up?.proxy_status || null,
      createdAt: a.created_at,
    };
  });

  /* ---- 汇总：当前账号池的可用总量 ---- */
  const alive = accounts.filter((a) => a.status !== 'missing');
  const usable = alive.filter((a) => a.status === 'ok');
  const withPct = usable.filter((a) => a.quota?.weeklyLeftPct != null);
  const summary = {
    total: alive.length,
    usable: usable.length,
    // 平均剩余周额度（多账号时即「还能跑几成」的平均值）
    weeklyLeftPct: withPct.length
      ? Math.round(withPct.reduce((s, a) => s + a.quota.weeklyLeftPct, 0) / withPct.length)
      : null,
    // 各账号剩余比例之和，例如 2 个账号各 60% → 120%
    pooledWeeklyPct: withPct.length
      ? Math.round(withPct.reduce((s, a) => s + a.quota.weeklyLeftPct, 0))
      : null,
    weeklyReset: withPct.map((a) => a.quota.weeklyReset).find(Boolean) || null,
    tokensLeft: usable.map((a) => a.quota?.tokensLeft).filter(Boolean),
    checkedAt: usable.map((a) => a.quota?.checkedAt).filter(Boolean).sort().pop() || null,
  };

  res.json({ accounts, summary, upstreamUp: upstream.length > 0 });
});

/* 触发一次上游额度刷新（全池） */
r.post('/quota', requireAuth, async (req, res) => {
  try {
    const out = await muse.queryQuota(req.body?.accountId);
    await syncFromUpstream();
    res.json({ ok: true, quota: parseQuota(out) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* 管理员批量登录导入。密码、2FA 链接和验证码仅转交上游内存任务，不落本地数据库。 */
r.post('/credential-imports', requireAuth, requireAdmin, async (req, res) => {
  const mode = String(req.body?.mode || '');
  let accounts;
  try {
    accounts = parseCredentialRows(mode, req.body?.raw);
    req.body.raw = null;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const job = await muse.startCredentialImport({ mode, accounts });
    res.json(job);
  } catch (e) {
    res.status(e.status === 409 ? 409 : 502).json({ error: e.message });
  } finally {
    for (const account of accounts) {
      account.password = null;
      account.otp_url = null;
    }
    accounts.length = 0;
  }
});

r.get('/credential-imports/:jobId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const job = await muse.credentialImportStatus(req.params.jobId);
    if (['completed', 'completed_with_errors', 'failed'].includes(job.status)) {
      await syncFromUpstream();
    }
    res.json(job);
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
  }
});

r.post('/credential-imports/:jobId/code', requireAuth, requireAdmin, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  const index = Number(req.body?.index);
  req.body.code = null;
  if (!/^\d{6}$/.test(code) || !Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: '验证码必须是 6 位数字' });
  }
  try {
    res.json(await muse.submitCredentialCode(req.params.jobId, index, code));
  } catch (e) {
    res.status(e.status === 404 ? 404 : e.status === 409 ? 409 : 502).json({ error: e.message });
  }
});

// 核心：前端粘贴 Cookie 头即可导入
r.post('/', requireAuth, async (req, res) => {
  const { cookie, label } = req.body || {};
  if (!cookie || String(cookie).trim().length < 10) {
    return res.status(400).json({ error: '请粘贴完整的 Cookie（至少包含 hatch_sess）' });
  }
  const text = String(cookie).trim();
  // 容错：用户可能粘贴了 "Cookie: xxx" 前缀或整段请求头
  const cleaned = text.replace(/^cookie\s*:\s*/i, '').replace(/\s*\n\s*/g, '; ');

  let result;
  try {
    result = await muse.addAccount({
      label: label || `muse-${new Date().toISOString().slice(5, 16)}`,
      cookie: cleaned,
    });
  } catch (e) {
    return res.status(502).json({ error: `上游拒绝导入：${e.message}` });
  }

  const added = (result.added || [])[0];
  if (!added) return res.status(502).json({ error: '上游未返回账号信息' });

  const row = upsertAccount({
    upstreamId: added.id,
    label: added.label,
    ownerId: req.user.role === 'admin' ? null : req.user.id,
    status: 'unknown',
    expiresAt: added.expires_at || null,
  });

  res.json({
    account: { id: row.id, upstreamId: row.upstream_id, label: row.label, status: 'unknown' },
    warning: result.warning || null,
    essentialMissing: result.essential_missing || [],
  });
});

r.post('/:id/test', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '账号不存在' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权操作该账号' });
  }
  try {
    const out = await muse.testAccount(row.upstream_id);
    const ok = out?.ok === true || out?.session_ok === true || out?.valid === true;
    upsertAccount({
      upstreamId: row.upstream_id,
      label: row.label,
      status: ok ? 'ok' : (out?.session_ok === false ? 'error' : 'unknown'),
      note: out?.note || out?.error || null,
      expiresAt: out?.expires_at || row.expires_at,
      quota: out?.quota ? JSON.stringify(out.quota) : row.quota,
    });
    res.json({ result: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

r.post('/:id/keepalive', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '账号不存在' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权操作该账号' });
  }
  try {
    res.json({ result: await muse.keepaliveAccount(row.upstream_id) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* 每账号独立代理。凭据仅写入上游账号存储，本平台数据库不保存代理密码。 */
r.post('/:id/proxy/test', requireAuth, requireAdmin, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row?.upstream_id) return res.status(404).json({ error: '账号不存在或尚未同步到上游' });
  const proxy = req.body?.proxy;
  if (!proxy?.server) return res.status(400).json({ error: '请输入代理地址' });
  try {
    res.json({ result: await muse.testAccountProxy(row.upstream_id, proxy) });
  } catch (e) {
    res.status(e.status === 400 ? 400 : e.status === 409 ? 409 : 502).json({ error: e.message });
  } finally {
    if (proxy && Object.hasOwn(proxy, 'password')) proxy.password = null;
  }
});

r.patch('/:id/proxy', requireAuth, requireAdmin, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row?.upstream_id) return res.status(404).json({ error: '账号不存在或尚未同步到上游' });
  const proxy = req.body?.proxy;
  if (proxy !== null && !proxy?.server) return res.status(400).json({ error: '请输入代理地址，或明确选择清除代理' });
  try {
    res.json({ account: await muse.patchAccount(row.upstream_id, { proxy }) });
  } catch (e) {
    res.status(e.status === 400 ? 400 : e.status === 409 ? 409 : 502).json({ error: e.message });
  } finally {
    if (proxy && Object.hasOwn(proxy, 'password')) proxy.password = null;
  }
});

r.delete('/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '账号不存在' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '无权删除该账号' });
  }
  if (row.upstream_id) {
    try { await muse.deleteAccount(row.upstream_id); } catch (e) { /* 上游已不存在也照删 */ }
  }
  deleteAccountRow(row.id);
  res.json({ ok: true });
});

export default r;
