// 从 bundle 里提取路由、API、中文文案，摸清功能面
import fs from 'node:fs';

const FILE = 'G:/museAPI/recon/jimengvip/index-P71l8Iua.js';
const js = fs.readFileSync(FILE, 'utf8');

const uniq = (arr) => [...new Set(arr)];

console.log('bundle 长度:', js.length);

/* 1. 路由 */
const routes = uniq([...js.matchAll(/path:\s*["'](\/[^"']*)["']/g)].map((m) => m[1]));
console.log('\n=== 路由 (' + routes.length + ') ===');
console.log(routes.join('\n'));

/* 2. API 端点 */
const apis = uniq(
  [...js.matchAll(/["'`](\/api\/[a-zA-Z0-9_\-/{}$:.]*)["'`]/g)].map((m) => m[1])
);
console.log('\n=== API 端点 (' + apis.length + ') ===');
console.log(apis.sort().join('\n'));

/* 3. 绝对 URL 后缀（可能是外部 API） */
const urls = uniq([...js.matchAll(/["'`](https?:\/\/[a-z0-9.\-]+\/[a-zA-Z0-9_\-/.?=&]*)["'`]/gi)].map((m) => m[1]))
  .filter((u) => !/\.(png|jpg|svg|webp|css|woff)/i.test(u));
console.log('\n=== 外部 URL (' + urls.length + ') ===');
console.log(urls.slice(0, 40).join('\n'));

/* 4. 中文文案（功能/菜单） */
const cn = uniq([...js.matchAll(/["'`]([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9·：:（）()、\s]{1,24})["'`]/g)].map((m) => m[1].trim()));
console.log('\n=== 中文文案 (' + cn.length + ') ===');
console.log(cn.slice(0, 400).join(' | '));

/* 5. 模型名 */
const models = uniq([...js.matchAll(/["'`]((?:seedance|grok|nano-banana|deepseek|gpt|doubao|veo|kling|sora)[a-zA-Z0-9._\-]*)["'`]/gi)].map((m) => m[1]));
console.log('\n=== 模型标识 (' + models.length + ') ===');
console.log(models.join('\n'));
