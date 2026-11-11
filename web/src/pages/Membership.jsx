import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Check, Loader2, Sparkles, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

const FALLBACK = [
  { key: 'starter', name: '初级版', price: 19.9, credits: 144, perks: ['标准画质', '基础模型', '普通队列'] },
  { key: 'standard', name: '中级版', price: 29.9, credits: 224, perks: ['高清画质', '全部模型', '优先队列'] },
  { key: 'pro', name: '高级版', price: 39.9, credits: 304, perks: ['高清画质', '全部模型', '去水印', '优先队列', '商用授权'] },
  { key: 'ultimate', name: '旗舰版', price: 49.9, credits: 384, perks: ['最高画质', '全部模型', '去水印', '最优先队列', '商用授权', '专属客服'] },
];

export default function Membership() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [data, setData] = useState({ plans: FALLBACK, current: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api.membership()
      .then((d) => setData({ plans: d.plans?.length ? d.plans : FALLBACK, current: d.current }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const subscribe = async (plan) => {
    if ((user?.credits ?? 0) < plan.credits) {
      return toast(`积分不足，订阅${plan.name}需要 ${plan.credits} 积分`, 'error');
    }
    setBusy(plan.key);
    try {
      await api.subscribe(plan.key);
      await refresh();
      const d = await api.membership();
      setData({ plans: d.plans, current: d.current });
      toast(`已订阅${plan.name}`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1240px] px-8 pb-20 pt-6">
      <p className="eyebrow">Membership</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Crown size={24} className="text-brand-400" strokeWidth={1.6} />
        会员中心
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">
        四档订阅，每月自动发放积分。当前余额{' '}
        <span className="font-mono text-brand-300">{user?.credits?.toLocaleString() ?? 0}</span> 积分
        {data.current && (
          <>
            {' · '}当前档位 <span className="text-brand-300">{data.current.name}</span>，到期{' '}
            {new Date(data.current.expiresAt).toLocaleDateString('zh-CN')}
          </>
        )}
      </p>

      {loading ? (
        <div className="grid place-items-center py-28 text-brand-400"><Loader2 size={22} className="animate-spin" /></div>
      ) : (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {data.plans.map((p, i) => {
            const featured = p.key === 'pro';
            const isCurrent = data.current?.plan === p.key;
            return (
              <div
                key={p.key}
                className={clsx(
                  'relative flex flex-col rounded-2xl border p-5 transition',
                  featured
                    ? 'border-brand-500/50 bg-gradient-to-b from-brand-500/[0.09] to-transparent shadow-[0_0_40px_-16px_rgba(15,169,138,.55)]'
                    : 'border-[#1a2030] bg-[#0c1017]/70 hover:border-[#2a3446]'
                )}
              >
                {featured && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full brand-gradient px-2.5 py-0.5 text-[10px] font-semibold text-white">
                    推荐
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute right-3 top-3 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] text-brand-300">
                    当前
                  </span>
                )}

                <p className="text-[13px] font-medium text-mist-200">{p.name}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="font-display text-[30px] font-bold leading-none text-white">{p.credits}</span>
                  <span className="text-[11.5px] text-mist-400">积分 / 月</span>
                </p>
                <p className="mt-1 font-mono text-[11px] text-mist-400">¥{p.price} / 月</p>

                <ul className="mt-4 flex-1 space-y-1.5">
                  {p.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-1.5 text-[11.5px] text-mist-300">
                      <Check size={11} className="shrink-0 text-brand-400" />
                      {perk}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => subscribe(p)}
                  disabled={busy === p.key}
                  className={clsx(
                    'mt-5 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-medium transition',
                    featured
                      ? 'brand-gradient text-white shadow-lg shadow-brand-600/25 hover:brightness-110'
                      : 'border border-[#232a38] text-mist-200 hover:border-brand-500/50 hover:text-white'
                  )}
                >
                  {busy === p.key ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  立即订阅
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60 px-5 py-4">
        <p className="text-[12px] text-mist-400">
          订阅按积分结算（本平台自托管，不接第三方支付）；积分不足可先充值。
        </p>
        <button
          onClick={() => nav('/recharge')}
          className="flex items-center gap-1.5 rounded-full border border-[#232a38] px-4 py-2 text-[12.5px] text-mist-200 transition hover:border-brand-500/50 hover:text-white"
        >
          <Zap size={13} className="text-gold-400" /> 去充值
        </button>
      </div>
    </div>
  );
}
