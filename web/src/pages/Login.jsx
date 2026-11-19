import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, ArrowRight, Gift, Zap, Clapperboard, Workflow, ShieldCheck, Film } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { Button, Field, Input, useToast } from '../components/ui.jsx';

const HIGHLIGHTS = [
  {
    icon: Clapperboard,
    title: '自动导演 v3 · 一句话到配音字幕成片',
    desc: '18 套摄影光学预设 + 首帧关键帧并行管线 + 神经网络旁白配音与电影字幕自动合成',
  },
  {
    icon: Workflow,
    title: '节点式无限画布 · 视觉与质检闭环',
    desc: '角色身份锚点贯穿全片，FFmpeg 画面质检与反馈驱动改词自愈，告别废片盲抽',
  },
  {
    icon: Zap,
    title: '多账号矩阵 · 多模型智能编排',
    desc: '统一调度 Muse 账号池、ChatGPT2API、Antigravity 与 Gemini，独立代理隔离保活',
  },
];

export default function Login() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const [mode, setMode] = useState(ref ? 'register' : 'login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
        toast('欢迎回到 ReelGraph Studio', 'ok');
      } else {
        await register(form.email.trim(), form.password, form.name.trim() || undefined, ref || undefined);
        toast(ref ? '注册成功，受邀奖励已到账' : '注册成功，已赠送初始创作积分', 'ok');
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-bg relative flex min-h-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="relative grid w-full max-w-[1060px] gap-12 lg:grid-cols-[minmax(0,1.15fr)_410px] lg:items-center">
        {/* ---------------- 左：品牌视觉叙事 ---------------- */}
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[11px] font-medium text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 pulse-dot" />
            SELF-HOSTED AI VIDEO PRODUCTION SUITE
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl brand-gradient text-white shadow-lg">
              <Film size={22} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[38px] font-extrabold tracking-tight text-mist-100">ReelGraph</span>
              <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.16em] text-brand-400">Studio</span>
            </div>
          </div>

          <h1 className="mt-6 text-[34px] font-semibold leading-[1.22] tracking-tight text-mist-100">
            把脑海里的分镜构想，<br />
            直接渲染成<span className="brand-text"> 可交付的成片</span>
          </h1>
          <p className="mt-3.5 max-w-lg text-[13.5px] leading-relaxed text-mist-300">
            集成分镜规划、角色定妆锚定、首帧关键帧并行生图、多账号视频生成、自动质检修复与配音字幕剪辑于一体的私有化创作台。
          </p>

          <div className="mt-8 space-y-3.5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="card card-hover flex items-start gap-3.5 p-3.5">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-brand-300">
                  <h.icon size={17} strokeWidth={1.85} />
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-mist-100">{h.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-mist-400">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---------------- 右：登录卡片 ---------------- */}
        <div className="w-full">
          <div className="mb-7 flex items-center justify-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-xl brand-gradient text-white">
              <Film size={16} />
            </div>
            <span className="font-display text-[24px] font-extrabold text-mist-100">ReelGraph</span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-brand-400">Studio</span>
          </div>

          <div className="card glow-frame p-6 sm:p-7">
            <div className="mb-5 flex rounded-xl border border-ink-700 bg-ink-900/80 p-1">
              {[
                ['login', '登录工作台'],
                ['register', '注册账号'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setMode(k); setErr(''); }}
                  className={clsx(
                    'flex-1 rounded-lg py-2 text-[13px] font-medium transition',
                    mode === k ? 'bg-ink-750 text-mist-100 shadow-sm' : 'text-mist-400 hover:text-mist-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-4">
              {ref && (
                <div className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3.5 py-2.5 text-[12px] text-brand-300">
                  <Gift size={14} /> 受邀注册通道已激活，注册后自动发放奖励积分
                </div>
              )}

              {mode === 'register' && (
                <Field label="创作者昵称">
                  <Input value={form.name} onChange={set('name')} placeholder="例如：Studio Director" />
                </Field>
              )}

              <Field label="登录邮箱">
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </Field>

              <Field label="密码" hint={mode === 'register' ? '建议使用至少 8 位字母与数字组合' : undefined}>
                <Input
                  type="password"
                  required
                  value={form.password}
                  onChange={set('password')}
                  placeholder={mode === 'register' ? '设置登录密码（至少 6 位）' : '输入账号密码'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </Field>

              {err && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12px] text-rose-300">
                  {err}
                </div>
              )}

              <Button type="submit" size="lg" loading={loading} className="w-full">
                {mode === 'login' ? '进入创作工作台' : '创建账号并开始'}
                {!loading && <ArrowRight size={16} />}
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-1.5 border-t border-ink-700/70 pt-4 text-[11px] text-mist-400">
              <ShieldCheck size={13} className="text-brand-400" />
              <span>所有凭据采用 AES-256-GCM 加密存储于您的私有实例</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
