// 端到端冒烟测试：登录 → 元信息 → 账号池 → 建任务（不真生成则跳过上游调用）
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const log = (label, ok, extra = '') =>
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);

let pass = 0, fail = 0;
const check = (label, cond, extra) => { cond ? pass++ : fail++; log(label, cond, extra); };

const main = async () => {
  console.log('--- 平台冒烟测试 ---');

  const health = await call('/api/health');
  check('健康检查', health.status === 200 && health.data.ok);

  // 管理员登录
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@muse.local', password: 'admin123456' },
  });
  check('管理员登录', login.status === 200 && !!login.data.token, login.data?.error || '');
  const token = login.data.token;
  if (!token) return finish();

  const me = await call('/api/auth/me', { token });
  check('获取当前用户', me.status === 200 && me.data.user.role === 'admin', `credits=${me.data?.user?.credits}`);

  const meta = await call('/api/meta', { token });
  check('读取平台配置', meta.status === 200, `时长 ${meta.data?.durations} 价格 ${JSON.stringify(meta.data?.price)}`);

  // 账号池
  const acc = await call('/api/accounts', { token });
  check('账号池接口', acc.status === 200, `共 ${acc.data?.accounts?.length ?? 0} 个账号`);

  // 任务列表
  const jobs = await call('/api/jobs?pageSize=5', { token });
  check('任务列表', jobs.status === 200, `共 ${jobs.data?.total ?? 0} 条`);

  // 后台
  const ov = await call('/api/admin/overview', { token });
  check('后台概览', ov.status === 200, `用户 ${ov.data?.stats?.users} 任务 ${ov.data?.stats?.jobs}`);

  const sys = await call('/api/admin/system', { token });
  check('上游系统状态', sys.status === 200 && !sys.data?.error,
    sys.data?.error || `浏览器 ${sys.data?.upstream?.browser_running}，账号 ${sys.data?.upstream?.stats?.total ?? 0}`);

  // 注册普通用户
  const email = `test${Date.now()}@example.com`;
  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'test123456', name: '测试用户' },
  });
  check('新用户注册', reg.status === 200 && reg.data.user.credits === 100, `赠送 ${reg.data?.user?.credits} 积分`);

  finish();
};

function finish() {
  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试异常', e); process.exit(1); });
