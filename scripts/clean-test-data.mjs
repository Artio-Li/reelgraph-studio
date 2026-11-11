// 清理测试期间产生的数据，保留管理与演示内容
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('G:/museAPI/server/data/studio.db');

const r1 = db.prepare("DELETE FROM api_keys WHERE name LIKE '%测试%'").run().changes;
const r2 = db.prepare("DELETE FROM users WHERE email LIKE 'ref%@example.com' OR email LIKE 'test%@example.com'").run().changes;
const r3 = db.prepare("DELETE FROM orders WHERE user_id NOT IN (SELECT id FROM users)").run().changes;

console.log(`清理测试密钥 ${r1} 个`);
console.log(`清理测试用户 ${r2} 个`);
console.log(`清理孤儿订单 ${r3} 条`);

console.log('\n当前数据：');
for (const [label, sql] of [
  ['用户', 'SELECT COUNT(*) n FROM users'],
  ['任务', 'SELECT COUNT(*) n FROM jobs'],
  ['账号', 'SELECT COUNT(*) n FROM accounts'],
  ['帖子', 'SELECT COUNT(*) n FROM posts'],
  ['订单', 'SELECT COUNT(*) n FROM orders'],
  ['密钥', 'SELECT COUNT(*) n FROM api_keys'],
]) {
  console.log(` ${label}: ${db.prepare(sql).get().n}`);
}

db.close();
