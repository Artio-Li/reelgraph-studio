// 把目标站用的字体下到本地自托管（离线可用，不依赖 CDN）
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'G:/museAPI/web/public/fonts';
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const FAMILIES = [
  { css: 'https://fonts.loli.net/css2?family=Baloo+2:wght@600;700;800&display=swap', slug: 'baloo2' },
  { css: 'https://fonts.loli.net/css2?family=JetBrains+Mono:wght@400;500;700&display=swap', slug: 'jetbrains' },
];

let outCss = '/* 自托管字体：Baloo 2（标题）+ JetBrains Mono（数据） */\n';

for (const fam of FAMILIES) {
  const res = await fetch(fam.css, { headers: { 'User-Agent': UA } });
  const css = await res.text();

  // 只保留 latin 区块（原站也主要用 latin）
  const blocks = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
  let n = 0;

  for (const block of blocks) {
    if (!/U\+0000-00FF/.test(block) && blocks.length > 2) continue; // 跳过非 latin
    const urlM = block.match(/url\((https:\/\/[^)]+)\)/);
    if (!urlM) continue;
    const url = urlM[1];
    const weightM = block.match(/font-weight:\s*([0-9]+)/);
    const weight = weightM ? weightM[1] : '400';
    const familyM = block.match(/font-family:\s*'([^']+)'/);
    const family = familyM ? familyM[1] : 'Unknown';

    const file = `${fam.slug}-${weight}.woff2`;
    const dest = path.join(OUT, file);
    if (!fs.existsSync(dest)) {
      const bin = await fetch(url, { headers: { 'User-Agent': UA } });
      const buf = Buffer.from(await bin.arrayBuffer());
      fs.writeFileSync(dest, buf);
      console.log(`下载 ${family} ${weight} → ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
    }

    outCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fonts/${file}') format('woff2');}\n`;
    n++;
  }
  console.log(`${fam.slug}: ${n} 个字形块`);
}

fs.writeFileSync(path.join(OUT, 'fonts.css'), outCss);
console.log('\n已生成 fonts.css');
