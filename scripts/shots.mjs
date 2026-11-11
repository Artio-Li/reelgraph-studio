// UI 截图验证：登录后逐页截图，输出到 shots/
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = path.resolve('shots');
fs.mkdirSync(OUT, { recursive: true });

const pages = [
  ['studio', '/studio'],
  ['works', '/works'],
  ['accounts', '/accounts'],
  ['credits', '/credits'],
  ['admin', '/admin'],
];

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // 登录页
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, '01-login.png') });
  console.log('📸 登录页');

  // 走真实登录表单
  await page.type('input[type=email]', 'admin@muse.local');
  await page.type('input[type=password]', 'admin123456');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname === '/studio', { timeout: 15000 });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, '02-studio.png') });
  console.log('📸 创作台');

  for (const [name, route] of pages.slice(1)) {
    await page.goto(BASE + route, { waitUntil: 'networkidle0' });
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, `${String(pages.findIndex(([n]) => n === name) + 2).padStart(2, '0')}-${name}.png`) });
    console.log('📸 ' + name);
  }

  if (errors.length) {
    console.log('\n⚠️  控制台错误：');
    [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  - ' + e.slice(0, 200)));
  } else {
    console.log('\n✅ 无控制台错误');
  }
} finally {
  await browser.close();
}
