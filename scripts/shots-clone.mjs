// 截我的平台新 UI，用于和目标站对比
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = path.resolve('shots/clone');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['home', '/home'],
  ['create', '/create'],
  ['history', '/history'],
  ['pricing', '/pricing'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', 'admin@muse.local');
  await page.type('input[type=password]', 'admin123456');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.pathname === '/home', { timeout: 15000 });
  await sleep(1500);

  for (const [name, route] of PAGES) {
    if (route !== '/home') await page.goto(BASE + route, { waitUntil: 'networkidle0' });
    await sleep(1400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('📸', name);
  }

  console.log(errs.length ? '\n⚠️ 错误:\n' + [...new Set(errs)].slice(0, 6).join('\n') : '\n✅ 无错误');
} finally {
  await browser.close();
}
