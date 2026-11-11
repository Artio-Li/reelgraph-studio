// 复现：创建上游任务后立即高频查询，看是否有时序 404
const MUSE = 'http://127.0.0.1:18610';
const H = { Authorization: 'Bearer m2a_muse_studio_local_2026', 'Content-Type': 'application/json' };

const j = async (url, opt = {}) => {
  const r = await fetch(url, { headers: H, ...opt });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
};

const create = await j(`${MUSE}/v1/videos`, {
  method: 'POST',
  body: JSON.stringify({ prompt: '时序测试：晨雾中的灯塔', duration: 5, size: '16:9' }),
});
console.log('创建:', create.status, JSON.stringify(create.data).slice(0, 200));
const id = create.data.id || create.data.task_id;
console.log('任务 ID:', id);

for (let i = 0; i < 8; i++) {
  const out = await j(`${MUSE}/v1/videos/${id}`);
  console.log(`#${i + 1} ${out.status} ${out.status === 200 ? out.data.status + ' / ' + (out.data.error || '') : JSON.stringify(out.data)}`);
  await new Promise((r) => setTimeout(r, 700));
}
