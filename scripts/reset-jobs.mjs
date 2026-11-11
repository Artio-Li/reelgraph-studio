// 清空所有任务记录（交付前重置演示数据）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB = 'G:/museAPI/server/data/studio.db';
const MEDIA = 'G:/museAPI/server/data/media';

const db = new DatabaseSync(DB);
const before = db.prepare('SELECT COUNT(*) n FROM jobs').get().n;
db.prepare('DELETE FROM jobs').run();
console.log(`已清空任务：${before} → 0`);

// 清掉没有对应任务的媒体文件
const files = fs.existsSync(MEDIA) ? fs.readdirSync(MEDIA) : [];
let removed = 0;
for (const f of files) {
  if (f === '.gitkeep') continue;
  const used = db.prepare('SELECT COUNT(*) n FROM jobs WHERE media_file = ?').get(f).n;
  if (!used) { fs.unlinkSync(path.join(MEDIA, f)); removed++; }
}
console.log(`已清理媒体文件：${removed} 个`);

// 清掉自动化测试产生的临时用户
const tu = db.prepare("DELETE FROM users WHERE email LIKE 'test%@example.com'").run().changes;
if (tu) console.log(`已清理测试用户：${tu} 个`);

db.close();
