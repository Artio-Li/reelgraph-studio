// 验证无账号/失败路径：创建任务 → 上游报错 → 自动退款
const BASE = 'http://127.0.0.1:8787';

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: res.status, data: d };
};

const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@muse.local', password: 'admin123456' } });
const token = login.data.token;
const before = (await call('/api/auth/me', { token })).data.user.credits;
console.log('下单前积分:', before);

const out = await call('/api/videos', {
  method: 'POST',
  token,
  body: { prompt: '测试：雨夜霓虹街头，镜头推进', duration: 5, size: '16:9' },
});
console.log('创建任务 →', out.status, JSON.stringify(out.data).slice(0, 300));

await new Promise((r) => setTimeout(r, 800));
const after = (await call('/api/auth/me', { token })).data.user.credits;
console.log('下单后积分:', after, after === before ? '✅ 已退还' : '❌ 未退还');

const ledger = (await call('/api/auth/ledger', { token })).data.ledger.slice(0, 3);
console.log('\n最近流水:');
for (const l of ledger) console.log(`  ${l.delta > 0 ? '+' : ''}${l.delta}  ${l.reason}  余额=${l.balance_after}`);

const jobs = (await call('/api/jobs', { token })).data;
console.log('\n任务列表:', jobs.total, '条', jobs.jobs[0] ? `状态=${jobs.jobs[0].status} 错误=${(jobs.jobs[0].error || '').slice(0, 120)}` : '');
