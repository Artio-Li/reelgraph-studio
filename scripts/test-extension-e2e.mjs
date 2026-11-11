// 端到端验证浏览器扩展：加载真实扩展 → 设置 muse.ai cookie → 打开 /bind/CODE → 应自动绑定
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const EXT = process.env.EXTENSION_DIR || path.join(ROOT, 'extension');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@reelgraph.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-before-public-deployment';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
};

const api = async (p, o = {}) => {
  const r = await fetch(BASE + p, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};

// 管理员登录 + 生成绑定码
const login = await api('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
const token = login.d.token;
const gen = await api('/api/accounts/bind-code', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ label: '扩展端到端测试' }),
});
const code = gen.d.code;
console.log('绑定码:', code);

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HEADFUL ? false : 'new',
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--enable-unsafe-extension-debugging',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  console.log('Chrome:', await browser.version());
  const targets = browser.targets().map((t) => `${t.type()}:${t.url().slice(0, 60)}`);
  console.log('targets:', targets.join(' | '));

  const page = await browser.newPage();
  // 先写入登录态（不依赖真实访问 muse.ai）
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  const client = await page.createCDPSession();
  for (const [name, value] of Object.entries({
    hatch_sess: 'e2e_test_session_' + Date.now(),
    hatch_vml: '1794300000',
    hatch_gw: 'gw_test',
  })) {
    await client.send('Network.setCookie', {
      name, value, domain: '.muse.ai', path: '/', secure: true, httpOnly: true,
    });
  }

  // 登录平台（绑定页需要登录态）
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', ADMIN_EMAIL);
  await page.type('input[type=password]', ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname === '/create', { timeout: 15000 });

  // 打开绑定页
  await page.goto(`${BASE}/bind/${code}`, { waitUntil: 'networkidle0' });
  await sleep(1200);

  const extFlag = await page.evaluate(() =>
    document.documentElement.getAttribute('data-museapi-video-ext'));
  ok('扩展已注入绑定页', extFlag === '1', `data-museapi-video-ext=${extFlag}`);

  await sleep(4000);

  const text = await page.evaluate(() => document.body.innerText);
  ok('页面显示绑定成功', /绑定成功/.test(text), text.includes('绑定成功') ? '' : '仍在等待');

  // 服务端确认
  const st = await api(`/api/accounts/bind/${code}`);
  ok('服务端状态 done', st.d.status === 'done', st.d.message || '');

  // 账号入库
  const acc = await api('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
  const found = acc.d.accounts.find((a) => a.label === '扩展端到端测试');
  ok('账号进入账号池', !!found, found ? `id=${found.id}` : '未找到');

  await page.screenshot({ path: path.join(ROOT, 'shots', '10-ext-bind-success.png') });

  if (found) {
    await api(`/api/accounts/${found.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    console.log('已清理测试账号');
  }
} catch (e) {
  console.log('❌ 测试异常:', e.message);
  fail++;
} finally {
  if (browser) await browser.close();
}

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exitCode = fail ? 1 : 0;
