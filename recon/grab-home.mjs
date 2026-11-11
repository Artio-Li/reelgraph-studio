// 抓取目标站首页，保存 HTML 并列出资源清单
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.jimengvip.online';
const OUT = 'G:/museAPI/recon/jimengvip';
fs.mkdirSync(OUT, { recursive: true });

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: Object.fromEntries(res.headers), text: buf.toString('utf8') };
}

const html = await get(BASE + '/');
fs.writeFileSync(path.join(OUT, 'index.html'), html.text);
console.log('首页:', html.status, html.text.length, 'chars');
console.log('server:', html.headers.server || '-', '| content-type:', html.headers['content-type']);

// 提取 script / link
const scripts = [...html.text.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const links = [...html.text.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]);
const metas = [...html.text.matchAll(/<meta[^>]+>/g)].map((m) => m[0]).filter((m) => /name=|property=/.test(m));

console.log('\n=== scripts ===');
scripts.forEach((s) => console.log(' ', s));
console.log('=== css ===');
links.forEach((s) => console.log(' ', s));
console.log('=== meta ===');
metas.forEach((s) => console.log(' ', s.slice(0, 160)));

// 抓 JS/CSS
for (const src of [...scripts, ...links]) {
  const url = src.startsWith('http') ? src : BASE + src;
  const name = path.basename(new URL(url).pathname);
  if (!name) continue;
  try {
    const r = await get(url);
    fs.writeFileSync(path.join(OUT, name), r.text);
    console.log(`下载 ${name}  ${(r.text.length / 1024).toFixed(0)} KB  ${r.status}`);
  } catch (e) {
    console.log(`失败 ${name}: ${e.message}`);
  }
}
