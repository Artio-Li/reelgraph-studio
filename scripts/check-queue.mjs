import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('G:/museAPI/server/data/studio.db');
const rows = db.prepare('SELECT id, status, runs, max_runs, job_id, next_run_at, note FROM queue_items').all();
console.log('队列项:');
for (const r of rows) {
  console.log(` ${r.id} | ${r.status} | ${r.runs}/${r.max_runs} | job=${r.job_id} | next=${r.next_run_at} | ${r.note || ''}`);
}
const jobs = db.prepare('SELECT id, status, upstream_id, error FROM jobs ORDER BY created_at DESC LIMIT 5').all();
console.log('\n任务:');
for (const j of jobs) console.log(` ${j.id} | ${j.status} | upstream=${j.upstream_id} | ${(j.error || '').slice(0, 40)}`);
db.close();
