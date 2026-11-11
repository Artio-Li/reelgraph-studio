import { useEffect, useState } from 'react';
import { Users, UserPlus, Send, Loader2, Copy, CheckCircle2, Crown, UserCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

export default function Team() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    api.team().then(setData).catch((e) => toast(e.message, 'error'));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const transfer = async () => {
    if (!email.trim()) return toast('请填写对方邮箱', 'error');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast('请输入有效的积分数', 'error');
    setBusy(true);
    try {
      await api.transferCredits(email.trim(), n);
      await refresh();
      setEmail(''); setAmount('');
      toast(`已转赠 ${n} 积分`, 'ok');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast('已复制邀请码', 'ok');
    } catch {
      toast('复制失败', 'error');
    }
  };

  if (!data) {
    return <div className="grid h-full place-items-center text-brand-400"><Loader2 size={22} className="animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-[1000px] px-8 pb-20 pt-6">
      <p className="eyebrow">Team</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Users size={24} className="text-brand-400" strokeWidth={1.6} />
        团队模式
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">邀请成员加入，共享积分与协作</p>

      {/* 统计 */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ['直属成员', data.stats.direct, UserCheck],
          ['二级成员', data.stats.second, Users],
          ['邀请获得', data.stats.creditsEarned, Crown],
        ].map(([label, value, Icon]) => (
          <div key={label} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">{label}</span>
              <Icon size={14} className="text-brand-400" />
            </div>
            <p className="mt-1.5 font-display text-[26px] font-bold leading-none text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 成员列表 */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2432] px-4 py-3">
            <h2 className="text-[13.5px] font-semibold text-mist-200">团队成员（{data.members.length}）</h2>
            <button className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300">
              <UserPlus size={12} /> 邀请成员
            </button>
          </div>

          {data.members.length === 0 ? (
            <div className="grid place-items-center py-16 text-center">
              <Users size={26} className="text-mist-400/50" />
              <p className="mt-2 text-[12.5px] text-mist-300">还没有团队成员</p>
              <p className="mt-0.5 text-[11.5px] text-mist-400">把邀请码发给朋友，注册后自动进入团队</p>
            </div>
          ) : (
            <div className="divide-y divide-[#141922]">
              {data.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1b2230] text-[12px] text-mist-300">
                      {(m.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12.5px] text-mist-200">{m.name}</p>
                        <span className={clsx(
                          'rounded px-1 py-0.5 text-[9.5px]',
                          m.level === 1 ? 'bg-brand-500/15 text-brand-300' : 'bg-[#2a3040] text-mist-300'
                        )}>
                          {m.level === 1 ? '直属' : '二级'}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-ink-500">{m.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[11.5px] text-gold-400">{m.credits}</p>
                    <p className="text-[9.5px] text-ink-500">{fmtTime(m.joinedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 转赠 */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-mist-200">
              <Send size={13} className="text-brand-400" /> 积分转赠
            </h3>
            <p className="mb-3 text-[11px] text-mist-400">当前余额 <span className="font-mono text-gold-400">{user?.credits?.toLocaleString()}</span></p>

            <div className="space-y-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="对方注册邮箱"
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-900 px-3 text-[12px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="积分数"
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-900 px-3 font-mono text-[12px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
              />
              <button
                onClick={transfer}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg brand-gradient py-2 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 确认转赠
              </button>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="mb-1.5 text-[13px] font-semibold text-mist-200">团队邀请码</h3>
            <div className="flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2">
              <span className="flex-1 font-mono text-[13px] tracking-wider text-brand-300">{data.inviteCode}</span>
              <button onClick={copyCode} className="text-mist-400 hover:text-white">
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-mist-400">
              成员用同一个邀请码注册后自动归属于你；已有账号可通过「加入团队」填写。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
