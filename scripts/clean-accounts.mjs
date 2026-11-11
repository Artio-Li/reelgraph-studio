// 查看并清理测试遗留账号
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('G:/museAPI/server/data/studio.db');
const rows = db.prepare('SELECT id, upstream_id, label, status, created_at FROM accounts').all();
console.log('当前账号:', rows.length ? '' : '（空）');
for (const r of rows) console.log(` ${r.id} | ${r.label} | ${r.status} | ${new Date(r.created_at).toLocaleString('zh-CN')}`);

// 测试脚本造的账号 label 都带"测试"或"沙箱"
const del = db.prepare("DELETE FROM accounts WHERE label LIKE '%测试%' OR label LIKE '%沙箱%'").run().changes;
if (del) console.log(`已删除测试账号 ${del} 个`);
console.log('剩余:', db.prepare('SELECT COUNT(*) n FROM accounts').get().n);
db.close();
