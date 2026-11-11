import { useCallback, useEffect, useState } from 'react';
import {
  Users, Film, CheckCircle2, XCircle, Loader2, Cpu, Wallet, Settings2,
  RefreshCw, Search, Plus, Minus, ShieldOff, ShieldCheck, Save, Zap, MessageSquare, Trash2, TrendingUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtTime } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, useToast, Spinner, Empty } from '../components/ui.jsx';

const TABS = [
  ['overview', '概览', Cpu],
  ['users', '用户', Users],
  ['orders', '订单', Wallet],
  ['posts', '社区', MessageSquare],
  ['settings', '设置', Settings2],
];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="p-5 lg:p-7">
      <div className="mb-5 flex gap-1.5 rounded-xl bg-ink-850 p-1 w-fit">
        {TABS.map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition',
              tab === k ? 'bg-ink-700 text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'orders' && <OrdersPanel />}
      {tab === 'posts' && <PostsPanel />}
      {tab === 'settings' && <SettingsPanel />}
    </div>
  );
}

/* ------------------------------- 概览 ------------------------------- */
function Overview() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [sys, setSys] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ka, setKa] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, s] = await Promise.all([api.adminOverview(), api.adminSystem().catch((e) => ({ error: e.message }))]);
      setData(ov);
      setSys(s);
      api.adminTrend().then((t) => setTrend(t.days || [])).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const keepalive = async () => {
    setKa(true);
    try {
      const out = await api.adminKeepalive();
      const okN = out.results.filter((r) => r.ok).length;
      toast(`保活完成：${okN}/${out.results.length} 成功`, okN ? 'ok' : 'error');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setKa(false);
    }
  };

  if (loading && !data) {
    return <div className="grid place-items-center py-24 text-brand-400"><Spinner size={22} /></div>;
  }

  const s = data?.stats || {};
  const cards = [
    ['用户', s.users, Users, 'text-brand-300'],
    ['任务总数', s.jobs, Film, 'text-mist-200'],
    ['已完成', s.done, CheckCircle2, 'text-emerald-300'],
    ['失败', s.failed, XCircle, 'text-rose-300'],
    ['进行中', s.running, Loader2, 'text-amber-300'],
    ['账号数', s.accounts, ShieldCheck, 'text-violet-300'],
  ];

  const up = sys?.upstream;
  const st = up?.stats || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, val, Icon, color]) => (
          <div key={label} className="card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">{label}</span>
              <Icon size={13} className={color} />
            </div>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">{val ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 上游状态 */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
              <Cpu size={14} className="text-brand-400" /> 上游引擎 muse2api
            </h3>
            <Button variant="outline" size="sm" onClick={load} loading={loading}>
              <RefreshCw size={12} /> 刷新
            </Button>
          </div>

          {sys?.error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-300">
              连不上上游：{sys.error}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Row label="浏览器进程" value={up?.browser_running ? '运行中' : '空闲'} tone={up?.browser_running ? 'ok' : 'neutral'} />
                <Row label="账号可用" value={`${st.healthy ?? 0} / ${st.total ?? 0}`} />
                <Row label="异常账号" value={st.error ?? 0} tone={st.error ? 'error' : 'neutral'} />
                <Row label="媒体文件" value={up?.media_count ?? 0} />
              </div>
              <div className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-[11.5px] text-mist-400">
                <p>视频超时 {up?.config?.video_timeout}s · 图片超时 {up?.config?.image_timeout}s</p>
                <p className="mt-0.5">CDP 端口 {up?.config?.cdp_port}</p>
              </div>
              <Button
                variant="soft"
                size="sm"
                className="mt-3 w-full"
                loading={ka}
                onClick={keepalive}
              >
                <Zap size={12} /> 全池保活（延长会话）
              </Button>
            </>
          )}
        </div>

        {/* 最近任务 */}
        <div className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
            <Wallet size={14} className="text-brand-400" /> 最近任务
          </h3>
          <div className="space-y-1.5">
            {(data?.recent || []).length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-ink-500">还没有任务</p>
            )}
            {(data?.recent || []).map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-mist-300">{j.prompt}</span>
                <Badge
                  tone={j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'error' : 'brand'}
                >
                  {j.status === 'completed' ? '完成' : j.status === 'failed' ? '失败' : '进行'}
                </Badge>
                <span className="shrink-0 text-[10.5px] text-ink-500">{fmtAgo(j.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="生成视频" value={s.videos ?? 0} />
        <MiniStat label="生成图片" value={s.images ?? 0} />
        <MiniStat label="用户积分总额" value={s.credits ?? 0} />
        <MiniStat label="累计消耗" value={s.consumed ?? 0} />
      </div>

      {/* 近 7 天趋势 */}
      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
          <TrendingUp size={14} className="text-brand-400" /> 近 7 天
        </h3>
        {trend.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-500">暂无数据</p>
        ) : (
          <div className="flex items-end justify-between gap-2">
            {trend.map((d) => {
              const max = Math.max(1, ...trend.map((x) => x.jobs));
              const h = Math.max(4, Math.round((d.jobs / max) * 72));
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="font-mono text-[10px] text-mist-300">{d.jobs || ''}</span>
                  <div
                    className="w-full max-w-[34px] rounded-t-md bg-gradient-to-t from-brand-600/40 to-brand-400 transition-all"
                    style={{ height: `${h}px` }}
                    title={`${d.jobs} 个任务 · ${d.credits} 积分`}
                  />
                  <span className="font-mono text-[9.5px] text-ink-500">{d.date}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, tone = 'neutral' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-ink-900 px-2.5 py-1.5">
      <span className="text-ink-500">{label}</span>
      {tone === 'neutral' ? (
        <span className="font-medium text-mist-200">{value}</span>
      ) : (
        <Badge tone={tone}>{value}</Badge>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="card px-3.5 py-3">
      <p className="text-[11px] text-mist-400">{label}</p>
      <p className="mt-1 text-[17px] font-semibold tabular-nums text-white">{value.toLocaleString()}</p>
    </div>
  );
}

/* ------------------------------- 用户 ------------------------------- */
function UsersPanel() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const out = await api.adminUsers(query);
      setUsers(out.users);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(''); }, [load]);

  const patch = async (id, body, msg) => {
    try {
      const out = await api.adminPatchUser(id, body);
      setUsers((l) => l.map((u) => (u.id === id ? out.user : u)));
      toast(msg, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const recharge = (u) => {
    const v = prompt(`给 ${u.email} 增减积分（负数扣减）`, '100');
    if (!v) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return toast('请输入非零数字', 'error');
    patch(u.id, { credits: n }, n > 0 ? `已充值 ${n}` : `已扣减 ${-n}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            placeholder="搜索邮箱…"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="md" onClick={() => load(q)} loading={loading}>搜索</Button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">用户</th>
                <th className="px-3 py-2.5 font-medium">角色</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 text-right font-medium">积分</th>
                <th className="px-3 py-2.5 font-medium">注册</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-mist-200">{u.name}</p>
                    <p className="text-[11px] text-ink-500">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? '管理员' : '用户'}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.status === 'active' ? 'ok' : 'error'}>{u.status === 'active' ? '正常' : '封禁'}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-300">{u.credits}</td>
                  <td className="px-3 py-2.5 text-[11px] text-ink-500">{fmtTime(u.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => recharge(u)}
                        className="rounded-md border border-ink-600 p-1.5 text-mist-300 hover:border-brand-500/60 hover:text-brand-300"
                        title="增减积分"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={() => patch(u.id, { status: u.status === 'active' ? 'banned' : 'active' }, u.status === 'active' ? '已封禁' : '已解封')}
                        className={clsx(
                          'rounded-md border p-1.5',
                          u.status === 'active'
                            ? 'border-ink-600 text-mist-300 hover:border-rose-500/60 hover:text-rose-300'
                            : 'border-ink-600 text-rose-300 hover:border-emerald-500/60 hover:text-emerald-300'
                        )}
                        title={u.status === 'active' ? '封禁' : '解封'}
                      >
                        {u.status === 'active' ? <ShieldOff size={12} /> : <ShieldCheck size={12} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && !loading && <Empty icon={Users} title="没有用户" />}
      </div>
    </div>
  );
}

/* ------------------------------- 订单 ------------------------------- */
function OrdersPanel() {
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (k) => {
    setLoading(true);
    try {
      const out = await api.adminOrders(k);
      setOrders(out.orders || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(''); }, [load]);

  const total = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + (o.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[['', '全部'], ['recharge', '充值'], ['membership', '订阅']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setKind(k); load(k); }}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] transition',
              kind === k ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-[#1e2432] text-mist-300 hover:text-white'
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-mist-400">
          已支付合计 <span className="font-mono text-gold-400">¥{total.toFixed(2)}</span>
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">订单号</th>
                <th className="px-3 py-2.5 font-medium">用户</th>
                <th className="px-3 py-2.5 font-medium">类型</th>
                <th className="px-3 py-2.5 text-right font-medium">金额</th>
                <th className="px-3 py-2.5 text-right font-medium">积分</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-mist-300">{o.id}</td>
                  <td className="px-3 py-2.5 text-[11.5px] text-mist-300">{o.email || '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={o.kind === 'recharge' ? 'brand' : 'warn'}>
                      {o.kind === 'recharge' ? '充值' : '订阅'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-mist-100">¥{o.amount}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gold-400">+{o.credits}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={o.status === 'paid' ? 'ok' : 'neutral'}>
                      {o.status === 'paid' ? '已支付' : o.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-500">{fmtTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && !loading && <Empty icon={Wallet} title="暂无订单" />}
      </div>
    </div>
  );
}

/* ------------------------------- 社区 ------------------------------- */
function PostsPanel() {
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.adminPosts();
      setPosts(out.posts || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!confirm(`删除帖子「${p.title}」？`)) return;
    try {
      await api.adminDeletePost(p.id);
      setPosts((l) => l.filter((x) => x.id !== p.id));
      toast('已删除', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-700 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-mist-200">社区帖子（{posts.length}）</h3>
      </div>
      {loading ? (
        <div className="grid place-items-center py-16 text-brand-400"><Spinner size={18} /></div>
      ) : posts.length === 0 ? (
        <Empty icon={MessageSquare} title="暂无帖子" />
      ) : (
        <div className="divide-y divide-ink-800">
          {posts.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-mist-200">{p.title}</p>
                <p className="mt-0.5 line-clamp-1 text-[11.5px] text-mist-400">{p.content}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-500">
                  {p.email} · {p.category} · ♥{p.likes} · {p.reply_count} 回复 · {fmtTime(p.created_at)}
                </p>
              </div>
              <button onClick={() => remove(p)} className="shrink-0 rounded p-1.5 text-mist-400 hover:text-rose-400">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- 设置 ------------------------------- */
function SettingsPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.adminSettings().then((r) => setSettings(r.settings)).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const out = await api.adminSaveSettings(settings);
      setSettings(out.settings);
      toast('已保存', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="grid place-items-center py-24 text-brand-400"><Spinner size={20} /></div>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-5">
        <h3 className="mb-4 text-[13.5px] font-semibold text-mist-200">站点</h3>
        <div className="space-y-3.5">
          <Field label="站点名称">
            <Input value={settings.siteName} onChange={set('siteName')} />
          </Field>
          <Field label="首页公告" hint="留空则不显示">
            <Input value={settings.notice} onChange={set('notice')} placeholder="例如：新用户注册送 100 积分" />
          </Field>
          <Field label="开放注册">
            <Select value={settings.allowRegister} onChange={set('allowRegister')}>
              <option value="1">允许自助注册</option>
              <option value="0">关闭注册（仅管理员建号）</option>
            </Select>
          </Field>
          <Field label="注册赠送积分">
            <Input type="number" value={settings.signupCredits} onChange={set('signupCredits')} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">定价（积分）</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">视频消耗 = 基础价 + 每秒单价 × 时长；例：10 + 2×5s = 20</p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="视频基础价">
            <Input type="number" value={settings.priceVideoBase} onChange={set('priceVideoBase')} />
          </Field>
          <Field label="视频每秒单价">
            <Input type="number" value={settings.priceVideoPerSecond} onChange={set('priceVideoPerSecond')} />
          </Field>
          <Field label="图片单价">
            <Input type="number" value={settings.priceImage} onChange={set('priceImage')} />
          </Field>
        </div>
      </div>

      <Button loading={saving} onClick={save}>
        <Save size={14} /> 保存设置
      </Button>
    </div>
  );
}
