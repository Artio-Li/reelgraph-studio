// 从 CSS 提取设计 token：颜色变量、字体、圆角、阴影、间距
import fs from 'node:fs';

const css = fs.readFileSync('G:/museAPI/recon/jimengvip/index-C7kowFt6.css', 'utf8');
console.log('CSS 长度:', css.length, '\n');

const uniq = (a) => [...new Set(a)];

/* 1. CSS 变量定义 */
const vars = uniq([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => `${m[1]}: ${m[2].trim()}`));
console.log('=== CSS 变量 (' + vars.length + ') ===');
console.log(vars.slice(0, 120).join('\n'));

/* 2. 出现频率最高的十六进制颜色 */
const hexes = uniq([...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()));
const freq = new Map();
for (const h of hexes) freq.set(h, (css.match(new RegExp(h, 'g')) || []).length);
const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log('\n=== 高频颜色 (hex, 出现次数) ===');
console.log(top.map(([h, n]) => `${h} ×${n}`).join('\n'));

/* 3. 字体族 */
const fonts = uniq([...css.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim()));
console.log('\n=== font-family ===');
console.log(fonts.slice(0, 12).join('\n'));

/* 4. 圆角 */
const radii = uniq([...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim()));
console.log('\n=== border-radius ===');
console.log(radii.slice(0, 20).join(' | '));

/* 5. 关键类名前缀（判断 UI 库：tailwind? element-plus?） */
const classes = uniq([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]{2,40})[{,:]/g)].map((m) => m[1]));
const prefix = {};
for (const c of classes) {
  const p = c.split(/[-_]/)[0];
  prefix[p] = (prefix[p] || 0) + 1;
}
const topPrefix = Object.entries(prefix).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log('\n=== 类名前缀 top ===');
console.log(topPrefix.map(([p, n]) => `${p}(${n})`).join(' '));

/* 6. 品牌色线索：找 teal/mint/emerald/green 类 */
const brand = uniq([...css.matchAll(/\.((?:bg|text|border)-(?:teal|emerald|green|cyan)-[0-9]{2,3})/g)].map((m) => m[1]));
console.log('\n=== 品牌色类 ===');
console.log(brand.slice(0, 30).join(' '));
