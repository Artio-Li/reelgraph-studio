/* ReelGraph Studio 账号绑定 —— background service worker
 *
 * 这个扩展只做一件事：
 *   用 chrome.cookies 读 muse.ai 的登录态（hatch_sess 等 HttpOnly cookie 只有
 *   浏览器扩展能读到），POST 到平台的一次性绑定接口。
 *
 * 不收集、不上报任何第三方。
 */

const MUSE_DOMAINS = ['muse.ai'];

async function readMuseCookies() {
  const all = [];
  for (const domain of MUSE_DOMAINS) {
    const list = await chrome.cookies.getAll({ domain });
    for (const c of list) all.push(c);
  }
  // 去重（同名同路径）
  const seen = new Map();
  for (const c of all) {
    const key = `${c.name}@${c.path}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

function toCookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function bindAccount({ api, code, label }) {
  const cookies = await readMuseCookies();
  if (!cookies.length) {
    return {
      ok: false,
      error: 'NO_COOKIE',
      message: '这个浏览器里没有 muse.ai 的 Cookie。请先在当前浏览器打开 https://muse.ai/ 登录，再回来点绑定。',
    };
  }

  const header = toCookieHeader(cookies);
  if (!/hatch_sess=/.test(header)) {
    return {
      ok: false,
      error: 'NO_SESSION',
      message: `读到了 ${cookies.length} 条 Cookie，但没有 hatch_sess，说明当前浏览器没登录 muse.ai。`,
    };
  }

  const res = await fetch(`${api.replace(/\/+$/, '')}/api/accounts/bind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, cookie: header, label }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, message: data.error || `平台返回 ${res.status}` };
  }
  return { ok: true, data, cookieCount: cookies.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'MUSE_BIND') return undefined;
  (async () => {
    try {
      const out = await bindAccount(msg);
      sendResponse(out);
    } catch (e) {
      sendResponse({ ok: false, error: 'NETWORK', message: String(e?.message || e) });
    }
  })();
  return true; // 保持异步通道
});
