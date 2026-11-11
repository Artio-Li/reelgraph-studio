// 用 mock 上游验证「成功路径」：completed → 下载媒体 → 落库 → 作品库可见
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pollOne } from '../server/src/worker.js';

const DB = 'G:/museAPI/server/data/studio.db';
const MEDIA = 'G:/museAPI/server/data/media';
const FAKE = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

const db = new DatabaseSync(DB);
const user = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
const jobId = 'job_mock_' + Date.now().toString(36);
const upstreamId = 'task_mock_' + Date.now().toString(36);
const ts = Date.now();

db.prepare(`INSERT INTO jobs(id,user_id,type,prompt,params,upstream_id,status,progress,cost,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  .run(jobId, user.id, 'video', 'mock 测试：海边日落', JSON.stringify({ duration: 5, size: '16:9' }),
    upstreamId, 'processing', 15, 20, ts, ts);

const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
const shaped = {
  id: job.id, userId: job.user_id, type: job.type, prompt: job.prompt,
  params: JSON.parse(job.params), upstreamId: job.upstream_id, status: job.status,
  progress: job.progress, cost: job.cost, refunded: !!job.refunded,
  result: null, error: null, mediaFile: null, accountId: null, createdAt: job.created_at,
};

// ---- mock 上游 ----
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  calls.push(u);
  if (u.includes('/v1/videos/')) {
    return new Response(JSON.stringify({
      id: upstreamId, status: 'completed', progress: 100, account: 'acc_mock_1',
      url: 'http://127.0.0.1:18610/v1/media/vid_mock.mp4',
      result: { url: 'http://127.0.0.1:18610/v1/media/vid_mock.mp4', filename: 'vid_mock.mp4', bytes: FAKE.length, kind: 'video' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/v1/media/')) {
    return new Response(FAKE, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
  }
  return realFetch(url, opt);
};

console.log('--- 成功路径 mock 测试 ---');
await pollOne(shaped);
await new Promise((r) => setTimeout(r, 1500));

const after = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
const localFile = after.media_file ? path.join(MEDIA, after.media_file) : null;

const checks = [
  ['轮询命中上游', calls.some((c) => c.includes('/v1/videos/'))],
  ['状态 completed', after.status === 'completed'],
  ['进度 100', after.progress === 100],
  ['媒体已落地', !!localFile && fs.existsSync(localFile)],
  ['落库大小正确', localFile && fs.statSync(localFile).size === FAKE.length],
  ['结果含 localUrl', (after.result || '').includes('/media/')],
  ['账号已回写', !!after.account_id],
];
let fail = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); if (!ok) fail++; }

// 通过接口确认作品库能读到
const res = await realFetch('http://127.0.0.1:8787/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@muse.local', password: 'admin123456' }),
});
const { token } = await res.json();
const jobsRes = await realFetch('http://127.0.0.1:8787/api/jobs?pageSize=5', { headers: { Authorization: `Bearer ${token}` } });
const list = await jobsRes.json();
const seen = list.jobs.find((j) => j.id === jobId);
console.log(`${seen && seen.mediaUrl ? '✅' : '❌'} 作品库可读 mediaUrl = ${seen?.mediaUrl}`);
if (!seen?.mediaUrl) fail++;

// 清理
db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
if (localFile && fs.existsSync(localFile)) fs.unlinkSync(localFile);
console.log(`\n${fail === 0 ? '全部通过' : fail + ' 项失败'}（已清理测试数据）`);
db.close();
process.exitCode = fail ? 1 : 0;
