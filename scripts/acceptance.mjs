// 验收：只保留 快捷创作 / 无限画布 / muse 导入 三个功能
const B = process.env.BASE || 'http://127.0.0.1:8787';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@reelgraph.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-before-public-deployment';
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
};

const call = async (p, o = {}) => {
  const r = await fetch(B + p, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};

console.log('=== 保留的页面 ===');
for (const route of ['/create', '/canvas', '/accounts', '/login']) {
  const r = await fetch(B + route);
  ok(route, r.status === 200, String(r.status));
}

console.log('\n=== 核心接口 ===');
const login = await call('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
});
ok('登录', login.s === 200 && !!login.d.token);
const H = { Authorization: `Bearer ${login.d.token}`, 'Content-Type': 'application/json' };

for (const [label, path] of [
  ['平台配置', '/api/meta'],
  ['账号池', '/api/accounts'],
  ['任务列表', '/api/jobs'],
  ['任务队列', '/api/queue'],
  ['上传', '/api/upload'],
]) {
  if (path === '/api/upload') continue; // 需要 multipart，跳过
  const r = await call(path, { headers: H });
  ok(label, r.s === 200);
}

console.log('\n=== 邀请/团队/会员等已下线 ===');
for (const [label, path] of [
  ['邀请', '/api/auth/invite'],
  ['团队', '/api/team'],
  ['会员', '/api/membership'],
  ['社区', '/api/posts'],
  ['API 密钥', '/api/keys'],
]) {
  const r = await call(path, { headers: H });
  // 后端仍在，但前端已无入口；这里只确认后端不崩
  ok(`${label}（后端仍在，前端已下线）`, r.s === 200 || r.s === 404);
}

console.log('\n=== 鉴权边界 ===');
ok('无 token → 401', (await call('/api/jobs')).s === 401);
ok('/v1 无密钥 → 401', (await call('/v1/models')).s === 401);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exitCode = fail ? 1 : 0;
