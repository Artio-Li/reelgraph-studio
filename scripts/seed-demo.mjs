// 插入演示数据（用于截图/预览），跑完可再用 --clean 清掉
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('G:/museAPI/server/data/studio.db');
const clean = process.argv.includes('--clean');

if (clean) {
  const n = db.prepare("DELETE FROM jobs WHERE id LIKE 'job_demo%'").run().changes;
  console.log('已清理演示数据:', n);
  db.close();
  process.exit(0);
}

const u = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
const ts = Date.now();

const rows = [
  {
    id: 'job_demo1', type: 'image',
    prompt: '赛博朋克机械柴犬，霓虹雨夜，电影级光影，8k',
    params: { size: '1:1', images: [] },
    status: 'completed', progress: 100, cost: 5,
    media: 'demo_shot.png',
    result: { url: '/media/demo_shot.png', localUrl: '/media/demo_shot.png' },
    created_at: ts - 3600_000,
  },
  {
    id: 'job_demo2', type: 'video',
    prompt: '雨后的巷口，女孩撑伞回头，慢镜头，暖色调，浅景深',
    params: { duration: 5, size: '16:9', images: [] },
    status: 'processing', progress: 45, cost: 20,
    media: null, result: null,
    created_at: ts - 120_000,
  },
  {
    id: 'job_demo3', type: 'video',
    prompt: '雪山之巅云雾翻涌，白鹰掠过镜头，光束穿透云层',
    params: { duration: 8, size: '9:16', images: [] },
    status: 'failed', progress: 15, cost: 26, refunded: 1,
    media: null, result: null, error: '没有可用账号，请先在管理页面导入 cookie',
    created_at: ts - 7200_000,
  },
];

for (const r of rows) {
  db.prepare(`INSERT OR REPLACE INTO jobs
    (id, user_id, type, prompt, params, status, progress, cost, media_file, result, error, refunded, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.id, u.id, r.type, r.prompt, JSON.stringify(r.params), r.status, r.progress, r.cost,
      r.media, r.result ? JSON.stringify(r.result) : null, r.error || null, r.refunded || 0, r.created_at, r.created_at);
}

console.log('演示数据已插入:', db.prepare('SELECT COUNT(*) n FROM jobs').get().n, '条');
db.close();
