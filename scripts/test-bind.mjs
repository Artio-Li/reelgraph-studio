// 验证「免 F12 绑定」链路：生成码 → 扩展提交 cookie → 入库 → 码失效
const B = 'http://127.0.0.1:8787';
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

const login = await call('/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@muse.local', password: 'admin123456' }),
});
const token = login.d.token;
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// 1. 生成绑定码
const gen = await call('/api/accounts/bind-code', {
  method: 'POST', headers: auth, body: JSON.stringify({ label: '自动绑定测试' }),
});
ok('生成绑定码', gen.s === 200 && !!gen.d.code, gen.d.code?.slice(0, 12) + '…');
const code = gen.d.code;

// 2. 查询状态应为 pending
const st1 = await call(`/api/accounts/bind/${code}`);
ok('初始状态 pending', st1.s === 200 && st1.d.status === 'pending');

// 3. 没有 hatch_sess 应被拒
const noSess = await call('/api/accounts/bind', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, cookie: 'foo=bar; baz=qux' }),
});
ok('缺 hatch_sess 被拒', noSess.s === 400, noSess.d.error);

// 4. 正常提交（模拟扩展送来的 cookie）
const fakeCookie = 'hatch_sess=fake_local_test_session; hatch_vml=1794300000; other=1';
const bind = await call('/api/accounts/bind', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, cookie: fakeCookie }),
});
ok('提交 cookie 完成绑定', bind.s === 200 && bind.d.ok === true, bind.d?.account?.label || bind.d.error);

// 5. 状态应变 done
const st2 = await call(`/api/accounts/bind/${code}`);
ok('状态变为 done', st2.d.status === 'done', st2.d.message || '');

// 6. 重复使用同码应被拒
const again = await call('/api/accounts/bind', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, cookie: fakeCookie }),
});
ok('绑定码一次性', again.s === 409, again.d.error);

// 7. 账号出现在列表里
const acc = await call('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
const found = acc.d.accounts.find((a) => a.label === '自动绑定测试');
ok('账号进入账号池', !!found, found ? `status=${found.status}` : '未找到');

// 8. 不存在的码
const bogus = await call('/api/accounts/bind/not-a-real-code');
ok('无效码返回 404', bogus.s === 404);

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);

// 默认清理测试账号（--keep 可保留观察）
if (found && !process.argv.includes('--keep')) {
  await call(`/api/accounts/${found.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  console.log('已清理测试账号');
}

process.exitCode = fail ? 1 : 0;
