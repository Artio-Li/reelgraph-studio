// 在 Node 沙箱里真实执行扩展的 background.js，验证它读 cookie → 提交 → 回传结果的完整逻辑。
// （Chrome 157 起 --load-extension 在自动化环境被禁用，无法用 puppeteer 直接加载扩展。）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const EXT = process.env.EXTENSION_DIR || path.join(ROOT, 'extension');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@reelgraph.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-before-public-deployment';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
};

/* ---------------- 1. manifest 静态校验 ---------------- */
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
ok('manifest 是 MV3', manifest.manifest_version === 3, `v${manifest.version}`);
ok('声明了 cookies 权限', manifest.permissions?.includes('cookies'));
const hosts = manifest.host_permissions || [];
ok('有 muse.ai 站点权限', hosts.some((h) => h.includes('muse.ai')));
ok('有平台入口权限', hosts.includes('http://*/*'));

for (const f of [manifest.background?.service_worker, ...(manifest.content_scripts || []).flatMap((c) => c.js || [])]) {
  if (!f) continue;
  ok(`文件存在 ${f}`, fs.existsSync(path.join(EXT, f)));
}
for (const f of ['popup.html', 'popup.js']) {
  ok(`文件存在 ${f}`, fs.existsSync(path.join(EXT, f)));
}

/* ---------------- 2. 准备一个绑定码 ---------------- */
const api = async (p, o = {}) => {
  const r = await fetch(BASE + p, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};

const login = await api('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
if (!login.d?.token) throw new Error(`管理员登录失败：${login.d?.error || login.s}`);
const token = login.d.token;
const gen = await api('/api/accounts/bind-code', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ label: 'background.js 沙箱测试' }),
});
const code = gen.d.code;
console.log('绑定码:', code);

/* ---------------- 3. 在沙箱里执行 background.js ---------------- */
const FAKE_COOKIES = [
  { name: 'hatch_sess', value: 'sandbox_session_' + Date.now(), path: '/', domain: '.muse.ai' },
  { name: 'hatch_vml', value: '1794300000', path: '/', domain: '.muse.ai' },
  { name: 'hatch_gw', value: 'gw_sandbox', path: '/', domain: '.muse.ai' },
];

let listener = null;
const sandbox = {
  chrome: {
    cookies: {
      getAll: async ({ domain }) => (domain === 'muse.ai' ? FAKE_COOKIES : []),
    },
    runtime: {
      onMessage: { addListener: (fn) => { listener = fn; } },
    },
  },
  fetch,
  console,
  URL,
};
vm.createContext(sandbox);

const src = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'background.js' });

ok('background 注册了消息监听', typeof listener === 'function');

/* ---------------- 4. 模拟 content script 发消息 ---------------- */
const response = await new Promise((resolve) => {
  const ret = listener({ type: 'MUSE_BIND', api: BASE, code }, {}, resolve);
  if (ret !== true) resolve({ ok: false, message: 'listener 没有保持异步通道' });
});

ok('background 完成绑定', response.ok === true, response.message || response.data?.account?.label);
ok('回传了 cookie 条数', response.cookieCount === 3, `${response.cookieCount} 条`);

/* ---------------- 5. 无 cookie 时的行为 ---------------- */
const noCookieResp = await new Promise((resolve) => {
  sandbox.chrome.cookies.getAll = async () => [];
  listener({ type: 'MUSE_BIND', api: BASE, code: 'whatever' }, {}, resolve);
});
ok('无 cookie 时明确报错', noCookieResp.ok === false && noCookieResp.error === 'NO_COOKIE', noCookieResp.message?.slice(0, 40));

/* ---------------- 6. 服务端确认 ---------------- */
const st = await api(`/api/accounts/bind/${code}`);
ok('服务端状态 done', st.d.status === 'done', st.d.message || '');

const acc = await api('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
const found = acc.d.accounts.find((a) => a.label === 'background.js 沙箱测试');
ok('账号进入账号池', !!found, found ? `id=${found.id}` : '未找到');

if (found) {
  await api(`/api/accounts/${found.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  console.log('已清理测试账号');
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exitCode = fail ? 1 : 0;
