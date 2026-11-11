// 截「一键绑定」相关页面：账号管理 + 绑定弹窗 + 绑定页
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = path.resolve('shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // 登录
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', 'admin@muse.local');
  await page.type('input[type=password]', 'admin123456');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname === '/studio', { timeout: 15000 });

  // 账号管理
  await page.goto(BASE + '/accounts', { waitUntil: 'networkidle0' });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, '07-accounts.png') });
  console.log('📸 账号管理');

  // 点「一键绑定」
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('一键绑定'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) {
    console.log('⚠️ 没找到「一键绑定」按钮');
  } else {
    await sleep(1800);
    await page.screenshot({ path: path.join(OUT, '08-bind-modal.png') });
    console.log('📸 一键绑定弹窗');

    // 抓绑定链接里的 code
    const code = await page.evaluate(() => {
      const el = [...document.querySelectorAll('div')].find((d) => /\/bind\/[A-Za-z0-9_-]{10,}/.test(d.textContent || '') && d.children.length === 0);
      const m = (el?.textContent || '').match(/\/bind\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    });

    if (!code) {
      console.log('⚠️ 没抓到绑定码');
    } else {
      console.log('   绑定码:', code.slice(0, 12) + '…');
      await page.goto(`${BASE}/bind/${code}`, { waitUntil: 'networkidle0' });
      await sleep(1600);
      await page.screenshot({ path: path.join(OUT, '09-bind-page.png') });
      console.log('📸 绑定页');
    }
  }

  console.log(errors.length ? '\n⚠️ ' + errors.join('\n') : '\n✅ 无页面错误');
} finally {
  await browser.close();
}
