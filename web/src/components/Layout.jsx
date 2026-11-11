import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Sparkles, Workflow, KeyRound, LogOut, Search, Sun, Moon, ChevronLeft, ChevronRight,
  Zap, UserRound, AlertTriangle, Bot, Settings2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { api } from '../lib/api.js';

const NAV = [
  { to: '/create', label: '快捷创作', icon: Sparkles },
  { to: '/gemini', label: 'Gemini 创作', icon: Bot },
  { to: '/canvas', label: '无限画布', icon: Workflow },
  { to: '/accounts', label: 'muse 导入', icon: KeyRound },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [light, setLight] = useState(false);
  const [quota, setQuota] = useState(null);

  // 账号池额度：路由切换与定时刷新
  useEffect(() => {
    let alive = true;
    const load = () => api.accounts()
      .then((d) => { if (alive) setQuota(d.summary); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [loc.pathname]);

  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('light', next);
  };

  return (
    <div className="relative flex h-full overflow-hidden bg-ink-900">
      {/* ---------------- 侧栏 ---------------- */}
      <aside
        className={clsx(
          'relative z-20 flex shrink-0 flex-col border-r border-[#1a1f2b] bg-ink-850/80 transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-[220px]'
        )}
      >
        <div className={clsx('flex h-[72px] items-center', collapsed ? 'justify-center' : 'px-5')}>
          <button onClick={() => nav('/create')} className="flex items-baseline gap-0.5">
            <span className="font-display text-[21px] font-extrabold italic leading-none tracking-tight text-white">
              {collapsed ? 'RG' : 'ReelGraph'}
            </span>
            {!collapsed && (
              <span className="mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-brand-400">
                Studio
              </span>
            )}
          </button>
        </div>

        {!collapsed && <p className="px-5 pb-2 pt-3 eyebrow">Workspace</p>}

        <nav className={clsx('flex flex-col gap-0.5', collapsed ? 'px-2 pt-3' : 'px-3')}>
          {[...NAV, ...(user?.role === 'admin' ? [{ to: '/admin', label: '管理员', icon: Settings2 }] : [])].map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="absolute -right-3 top-1/2 z-30 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-[#232a38] bg-ink-800 text-mist-400 shadow-lg transition hover:border-brand-500/50 hover:text-brand-300"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* 底部：账号状态 */}
        <div className="mt-auto border-t border-[#1a1f2b] p-3">
          {collapsed ? (
            <button
              onClick={logout}
              title="退出登录"
              className="grid h-9 w-full place-items-center rounded-lg text-mist-400 hover:bg-ink-800 hover:text-rose-400"
            >
              <LogOut size={14} />
            </button>
          ) : (
            <div className="rounded-xl border border-[#1e2432] bg-ink-900/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1b2230] text-[11px] font-semibold text-mist-200">
                  {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-mist-200">{user?.name || '未命名'}</p>
                  <p className="truncate font-mono text-[10px] text-ink-500">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  title="退出登录"
                  className="rounded-md p-1 text-mist-400 transition hover:bg-ink-700 hover:text-rose-400"
                >
                  <LogOut size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- 主区 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] shrink-0 items-center gap-4 px-6">
          <div className="group relative hidden max-w-[420px] flex-1 md:block">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-400" />
            <input
              placeholder="搜索模型、作品、提示词…"
              className="h-10 w-full rounded-full border border-[#202634] bg-ink-850/70 pl-10 pr-14 text-[13px] text-mist-100 outline-none transition placeholder:text-mist-400/70 focus:border-brand-500/50 focus:bg-ink-800"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[#242b39] bg-ink-800 px-1.5 py-0.5 text-[10px] text-mist-400">
              ⌘K
            </kbd>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={light ? '切换为深色' : '切换为浅色'}
              className="grid h-9 w-9 place-items-center rounded-full text-mist-300 transition hover:bg-ink-800 hover:text-white"
            >
              {light ? <Moon size={16} /> : <Sun size={16} />}
            </button>

            {/* 账号池额度（替代原来的虚拟积分） */}
            <button
              onClick={() => nav('/accounts')}
              title={
                quota?.usable
                  ? `可用账号 ${quota.usable}/${quota.total}` +
                    (quota.weeklyLeftPct != null ? ` · 周额度剩余 ${quota.weeklyLeftPct}%` : ' · 额度未查询') +
                    (quota.weeklyReset ? ` · ${quota.weeklyReset} 重置` : '') +
                    (quota.tokensLeft?.length ? ` · 额外 ${quota.tokensLeft.join('、')} tokens` : '')
                  : '还没有可用账号，点这里导入 muse 账号'
              }
              className={clsx(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition',
                quota?.usable
                  ? 'border-[#202634] bg-ink-850/70 hover:border-brand-500/50'
                  : 'border-amber-500/40 bg-amber-500/10 hover:border-amber-400'
              )}
            >
              {quota?.usable ? (
                <>
                  <Zap size={12} className="text-brand-400" />
                  <span className="font-mono text-[11.5px] text-mist-300">
                    {quota.usable} 账号
                  </span>
                  {quota.weeklyLeftPct != null && (
                    <>
                      <span className="text-[10px] text-ink-500">·</span>
                      <span className="font-mono text-[11.5px] font-semibold text-brand-300">
                        剩 {quota.weeklyLeftPct}%
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <AlertTriangle size={12} className="text-amber-400" />
                  <span className="text-[11.5px] text-amber-300">未接账号</span>
                </>
              )}
            </button>

            <button
              onClick={() => nav('/accounts')}
              className="flex items-center gap-1.5 rounded-full border border-[#202634] px-3 py-1.5 text-[12px] text-mist-300 transition hover:border-brand-500/50 hover:text-white"
              title="muse 账号导入"
            >
              <UserRound size={13} />
              <span className="hidden sm:inline">账号</span>
            </button>
          </div>
        </header>

        <main className="page-bg min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, collapsed }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex items-center rounded-xl transition-all',
          collapsed ? 'h-10 justify-center' : 'gap-3 px-3 py-2.5',
          isActive ? 'bg-[#141a26] text-white' : 'text-mist-300 hover:bg-[#12161f] hover:text-mist-100'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !collapsed && (
            <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(79,227,193,.8)]" />
          )}
          <Icon size={17} className={isActive ? 'text-brand-300' : ''} strokeWidth={1.8} />
          {!collapsed && <span className="text-[13.5px] font-medium">{label}</span>}
        </>
      )}
    </NavLink>
  );
}
