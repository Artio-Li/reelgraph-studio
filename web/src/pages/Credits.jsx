import { useEffect, useState } from 'react';
import { Coins, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Empty, useToast, Spinner } from '../components/ui.jsx';

export default function Credits() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.ledger()
      .then((r) => setRows(r.ledger))
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  const spent = rows.filter((r) => r.delta < 0).reduce((s, r) => s + -r.delta, 0);
  const gained = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);

  return (
    <div className="mx-auto max-w-3xl p-5 lg:p-7">
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="当前余额" value={user?.credits ?? 0} icon={Zap} tone="brand" />
        <Stat label="累计消耗" value={spent} icon={TrendingDown} tone="rose" />
        <Stat label="累计获得" value={gained} icon={TrendingUp} tone="emerald" />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-700 px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
            <Coins size={14} className="text-brand-400" /> 积分流水
            <span className="text-[11px] font-normal text-ink-500">最近 100 条</span>
          </h2>
        </div>

        {loading ? (
          <div className="grid place-items-center py-16 text-brand-400"><Spinner size={20} /></div>
        ) : rows.length === 0 ? (
          <Empty icon={Coins} title="还没有流水" desc="生成任务后会在这里记录" />
        ) : (
          <div className="divide-y divide-ink-800">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-mist-200">{r.reason}</p>
                  <p className="text-[11px] text-ink-500">{fmtTime(r.created_at)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={clsx('text-[13.5px] font-semibold tabular-nums', r.delta > 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {r.delta > 0 ? '+' : ''}{r.delta}
                  </p>
                  <p className="text-[10.5px] text-ink-500">余额 {r.balance_after}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const tones = {
    brand: 'from-brand-500/15 to-violet-500/10 text-brand-300',
    rose: 'from-rose-500/12 to-rose-500/5 text-rose-300',
    emerald: 'from-emerald-500/12 to-emerald-500/5 text-emerald-300',
  };
  return (
    <div className={clsx('card bg-gradient-to-br p-4', tones[tone])}>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-mist-400">{label}</span>
        <Icon size={14} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value.toLocaleString()}</p>
    </div>
  );
}
