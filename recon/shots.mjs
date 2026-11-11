// 遍历目标站公开路由并截图，同时记录重定向
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'https://www.jimengvip.online';
const OUT = 'G:/museAPI/recon/shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  ['root', '/'],
  ['login', '/login'],
  ['pricing', '/pricing'],
  ['docs', '/docs'],
  ['home', '/home'],
  ['create', '/create'],
  ['canvas', '/canvas'],
  ['forum', '/forum'],
  ['history', '/history'],
  ['api-platform', '/api-platform'],
  ['membership', '/membership'],
  ['invite', '/invite'],
  ['agent', '/agent'],
  ['team', '/team'],
  ['recharge', '/recharge'],
  ['settings', '/settings'],
  ['developer', '/developer'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  for (const [name, route] of ROUTES) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 25000 });
      await sleep(1800);
      const info = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        h1: document.querySelector('h1')?.innerText?.slice(0, 60) || '',
        bodyLen: document.body.innerText.length,
        canvas: !!document.querySelector('canvas'),
      }));
      const redirected = !info.url.endsWith(route) && route !== '/';
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(
        `${name.padEnd(12)} → ${new URL(info.url).pathname.padEnd(14)} ` +
        `title="${info.title.slice(0, 24)}" text=${info.bodyLen} ${info.canvas ? '[canvas]' : ''} ` +
        `${redirected ? '⟵ 重定向' : ''}`
      );
    } catch (e) {
      console.log(`${name.padEnd(12)} ✗ ${e.message.slice(0, 60)}`);
    }
  }

  if (consoleErrors.length) console.log('\n页面错误:', [...new Set(consoleErrors)].slice(0, 5));
} finally {
  await browser.close();
}
