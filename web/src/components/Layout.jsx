import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Workflow, KeyRound, LogOut, Search, Sun, Moon, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Bot, Settings2, Clapperboard, Coins, Command, ArrowUpRight, Menu, X, Film,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { api, fmtAgo } from '../lib/api.js';

const THEME_KEY = 'rg_theme';
const COLLAPSE_KEY = 'rg_sidebar_collapsed';

const NAV = [
  { to: '/create', label: '快捷创作', sub: '单镜视频 · 生图画廊', icon: Sparkles },
  { to: '/director', label: '自动导演', sub: '分镜 · 配音 · 一键成片', icon: Clapperboard, badge: 'PRO' },
  { to: '/canvas', label: '无限画布', sub: 'DAG 节点编排与剪辑', icon: Workflow },
  { to: '/gemini', label: 'AI 创作台', sub: '提示词扩写 · 角色定妆', icon: Bot },
  { to: '/accounts', label: '账号矩阵', sub: 'Muse 账号池与独立代理', icon: KeyRound },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [light, setLight] = useState(() => localStorage.getItem(THEME_KEY) === 'light');
  const [quota, setQuota] = useState(null);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('light', light);
    localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
  }, [light]);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

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

  // 全局 ⌘K / Ctrl+K 命令面板快捷键
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navItems = useMemo(
    () => [...NAV, ...(user?.role === 'admin' ? [{ to: '/admin', label: '系统管理', sub: '模型路由 · 全局设置', icon: Settings2 }] : [])],
    [user?.role],
  );

  return (
    <div className="relative flex h-full overflow-hidden bg-ink-900 text-mist-100">
      {/* 移动端遮罩 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ---------------- 侧边工作区导航栏 ---------------- */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-ink-700/75 glass transition-all duration-200 lg:static',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          collapsed ? 'lg:w-[72px] w-[240px]' : 'w-[240px]',
        )}
      >
        <div className={clsx('flex h-[68px] items-center justify-between', collapsed ? 'lg:justify-center px-5 lg:px-0' : 'px-5')}>
          <button onClick={() => nav('/create')} className="group flex items-center gap-2.5 text-left">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl brand-gradient text-white shadow-md">
              <Film size={16} strokeWidth={2.2} />
            </div>
            {(!collapsed || mobileOpen) && (
              <div className="leading-none">
                <div className="flex items-center gap-1.5">
                  <span className="font-display text-[19px] font-extrabold tracking-tight text-mist-100">
                    ReelGraph
                  </span>
                  <span className="rounded-md border border-brand-500/30 bg-brand-500/12 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-brand-300">
                    Studio
                  </span>
                </div>
                <p className="mt-1 font-mono text-[9.5px] tracking-[0.16em] text-mist-400">AI CINEMA ENGINE</p>
              </div>
            )}
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-750 lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {(!collapsed || mobileOpen) && (
          <p className="px-5 pb-2 pt-2 eyebrow">Creative Suite</p>
        )}

        <nav className={clsx('flex flex-col gap-1', collapsed && !mobileOpen ? 'px-2.5 pt-2' : 'px-3')}>
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed && !mobileOpen} />
          ))}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="absolute -right-3 top-1/2 z-30 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-ink-600 bg-ink-800 text-mist-400 shadow-lg transition hover:border-brand-500/60 hover:text-brand-300 lg:grid"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* 底部：用户信息卡片 */}
        <div className="mt-auto border-t border-ink-700/70 p-3">
          {collapsed && !mobileOpen ? (
            <button
              onClick={logout}
              title="退出登录"
              className="grid h-9 w-full place-items-center rounded-xl text-mist-400 transition hover:bg-ink-800 hover:text-rose-400"
            >
              <LogOut size={15} />
            </button>
          ) : (
            <div className="rounded-2xl border border-ink-700/80 bg-ink-900/55 p-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-[12px] font-bold text-brand-300">
                  {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12.5px] font-semibold text-mist-100">{user?.name || '创作者'}</p>
                    {user?.role === 'admin' && (
                      <span className="rounded bg-ink-750 px-1 py-0.2 font-mono text-[9px] text-mist-400">ADMIN</span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[10px] text-mist-400">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  title="退出登录"
                  className="rounded-lg p-1.5 text-mist-400 transition hover:bg-ink-750 hover:text-rose-400"
                >
                  <LogOut size={13} />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- 主内容容器 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-ink-700/60 glass px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-ink-700 bg-ink-850 text-mist-300 lg:hidden"
          >
            <Menu size={17} />
          </button>

          {/* 全局命令面板触发栏 */}
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="group flex h-10 max-w-[420px] flex-1 items-center gap-2.5 rounded-full border border-ink-700/90 bg-ink-900/65 px-3.5 text-left text-[12.5px] text-mist-400 transition hover:border-brand-500/45 hover:bg-ink-850 hover:text-mist-200"
          >
            <Search size={14} className="shrink-0 text-mist-400 transition group-hover:text-brand-400" />
            <span className="truncate">搜索页面、作品提示词、画布或导演任务…</span>
            <kbd className="ml-auto hidden shrink-0 items-center gap-0.5 rounded-md border border-ink-600/80 bg-ink-800 px-1.5 py-0.5 text-[10px] text-mist-400 sm:inline-flex">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {/* 积分余额徽章 */}
            <div
              title="账户当前可用创作积分（任务失败自动退还）"
              className="hidden items-center gap-1.5 rounded-full border border-ink-700/90 bg-ink-900/60 px-3 py-1.5 sm:flex"
            >
              <Coins size={12} className="text-gold-400" />
              <span className="font-mono text-[11.5px] font-semibold text-mist-200">
                {user?.credits ?? 0}
              </span>
              <span className="text-[10.5px] text-mist-400">积分</span>
            </div>

            {/* 账号池实时健康度 */}
            <button
              onClick={() => nav('/accounts')}
              title={
                quota?.usable
                  ? `可用账号 ${quota.usable}/${quota.total}` +
                    (quota.weeklyLeftPct != null ? ` · 周额度剩余 ${quota.weeklyLeftPct}%` : '') +
                    (quota.weeklyReset ? ` · ${quota.weeklyReset} 重置` : '')
                  : '还没有可用账号，点这里导入 Muse 账号'
              }
              className={clsx(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition',
                quota?.usable
                  ? 'border-ink-700/90 bg-ink-900/60 hover:border-brand-500/50'
                  : 'border-amber-500/40 bg-amber-500/10 hover:border-amber-400',
              )}
            >
              {quota?.usable ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-brand-400 pulse-dot" />
                  <span className="font-mono text-[11.5px] text-mist-200">
                    {quota.usable} 号在线
                  </span>
                  {quota.weeklyLeftPct != null && (
                    <>
                      <span className="text-[10px] text-mist-500">·</span>
                      <span className="font-mono text-[11.5px] font-semibold text-brand-300">
                        {quota.weeklyLeftPct}%
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
              onClick={() => setLight((v) => !v)}
              title={light ? '切换为暗房深色模式' : '切换为明亮浅色模式'}
              className="grid h-9 w-9 place-items-center rounded-full border border-ink-700/80 bg-ink-900/60 text-mist-300 transition hover:border-brand-500/40 hover:text-mist-100"
            >
              {light ? <Moon size={15} /> : <Sun size={15} />}
            </button>
          </div>
        </header>

        <main className="page-bg min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} navItems={navItems} />
    </div>
  );
}

function NavItem({ to, label, sub, badge, icon: Icon, collapsed }) {
  return (
    <NavLink
      to={to}
      title={collapsed ? `${label} — ${sub || ''}` : undefined}
      className={({ isActive }) =>
        clsx(
          'group relative flex items-center rounded-xl transition-all duration-150',
          collapsed ? 'h-10 justify-center' : 'gap-3 px-3 py-2.5',
          isActive
            ? 'border border-brand-500/25 bg-brand-500/10 text-mist-100 shadow-sm'
            : 'border border-transparent text-mist-300 hover:bg-ink-800/70 hover:text-mist-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !collapsed && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 shadow-[0_0_10px_rgba(79,227,193,.85)]" />
          )}
          <Icon size={17} className={clsx('shrink-0 transition', isActive ? 'text-brand-300' : 'text-mist-400 group-hover:text-mist-200')} strokeWidth={1.9} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[13px] font-medium">{label}</span>
                {badge && (
                  <span className="rounded-full bg-brand-500/20 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-brand-300">
                    {badge}
                  </span>
                )}
              </div>
              {sub && <p className="mt-0.5 truncate text-[10.5px] text-mist-400">{sub}</p>}
            </div>
          )}
        </>
      )}
    </NavLink>
  );
}

/* --------------------- 全局 ⌘K 命令与跳转面板 --------------------- */
function CommandPalette({ open, onClose, navItems }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [canvases, setCanvases] = useState([]);
  const [productions, setProductions] = useState([]);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    Promise.all([
      api.canvases().catch(() => ({ canvases: [] })),
      api.productions().catch(() => ({ productions: [] })),
      api.jobs({ pageSize: 12 }).catch(() => ({ jobs: [] })),
    ]).then(([cv, pr, jb]) => {
      setCanvases(cv.canvases || []);
      setProductions(pr.productions || []);
      setJobs(jb.jobs || []);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const go = useCallback((to) => {
    onClose();
    nav(to);
  }, [nav, onClose]);

  if (!open) return null;

  const kw = q.trim().toLowerCase();
  const matchedNav = navItems.filter((i) => !kw || `${i.label} ${i.sub || ''}`.toLowerCase().includes(kw));
  const matchedCanvases = canvases.filter((c) => !kw || String(c.name || '').toLowerCase().includes(kw)).slice(0, 5);
  const matchedProds = productions
    .filter((p) => !kw || `${p.plan?.title || ''} ${p.brief?.direction || ''}`.toLowerCase().includes(kw))
    .slice(0, 5);
  const matchedJobs = jobs.filter((j) => !kw || String(j.prompt || '').toLowerCase().includes(kw)).slice(0, 5);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className="card relative flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden fade-in glow-frame">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3.5">
          <Command size={16} className="text-brand-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入关键词跳转工作台、无限画布、导演成片或历史作品…"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-mist-100 outline-none placeholder:text-mist-400"
          />
          <kbd className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 text-[10px] text-mist-400">ESC</kbd>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {matchedNav.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 eyebrow">工作区导航</p>
              <div className="space-y-0.5">
                {matchedNav.map((item) => (
                  <button
                    key={item.to}
                    onClick={() => go(item.to)}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] text-mist-200 transition hover:bg-ink-750 hover:text-mist-100"
                  >
                    <span className="flex items-center gap-2.5">
                      <item.icon size={15} className="text-brand-400" />
                      <span>{item.label}</span>
                      {item.sub && <span className="text-[11px] text-mist-400">· {item.sub}</span>}
                    </span>
                    <ArrowUpRight size={13} className="text-mist-500" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedProds.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 eyebrow">自动导演成片</p>
              <div className="space-y-0.5">
                {matchedProds.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => go(`/director?id=${encodeURIComponent(p.id)}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[12.5px] text-mist-200 transition hover:bg-ink-750"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Clapperboard size={14} className="shrink-0 text-brand-400" />
                      <span className="truncate">{p.plan?.title || p.brief?.direction || '未命名短片'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-mist-400">{fmtAgo(p.createdAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedCanvases.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 eyebrow">无限画布工程</p>
              <div className="space-y-0.5">
                {matchedCanvases.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => go(`/canvas?canvas=${encodeURIComponent(c.id)}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[12.5px] text-mist-200 transition hover:bg-ink-750"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Workflow size={14} className="shrink-0 text-sky-400" />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-mist-400">{fmtAgo(c.updatedAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {matchedJobs.length > 0 && (
            <div>
              <p className="px-2 pb-1.5 eyebrow">最近创作素材</p>
              <div className="space-y-0.5">
                {matchedJobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => go(`/create?job=${encodeURIComponent(j.id)}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[12.5px] text-mist-200 transition hover:bg-ink-750"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Zap size={13} className="shrink-0 text-emerald-400" />
                      <span className="truncate">{j.prompt}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-mist-400">{j.type === 'image' ? '图片' : `${j.params?.duration || 5}s`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!matchedNav.length && !matchedCanvases.length && !matchedProds.length && !matchedJobs.length && (
            <p className="py-8 text-center text-[12.5px] text-mist-400">没有找到匹配的页面或作品</p>
          )}
        </div>
      </div>
    </div>
  );
}
