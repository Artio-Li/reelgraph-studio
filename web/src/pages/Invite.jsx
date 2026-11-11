import { useEffect, useState } from 'react';
import { Gift, Copy, Users, Loader2, CheckCircle2, Share2 } from 'lucide-react';
import { api, fmtTime } from '../lib/api.js';
import { useToast } from '../components/ui.jsx';

export default function Invite() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    api.invite().then(setData).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
      toast('已复制', 'ok');
    } catch {
      toast('复制失败，请手动选中', 'error');
    }
  };

  if (!data) {
    return <div className="grid h-full place-items-center text-brand-400"><Loader2 size={22} className="animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-20 pt-6">
      <p className="eyebrow">Invite</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Gift size={24} className="text-brand-400" strokeWidth={1.6} />
        邀请送积分
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">邀请好友注册，双方各得 {data.reward.inviter} 积分</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 邀请卡 */}
        <div className="relative overflow-hidden rounded-2xl border border-brand-500/25 bg-gradient-to-br from-brand-500/[0.12] to-transparent p-6">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="relative">
            <p className="text-[12px] text-mist-300">我的邀请码</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="font-display text-[32px] font-bold tracking-[0.12em] text-white">{data.code}</span>
              <button
                onClick={() => copy(data.code, 'code')}
                className="flex items-center gap-1 rounded-lg border border-[#232a38] px-2.5 py-1.5 text-[11.5px] text-mist-300 transition hover:border-brand-500/50 hover:text-white"
              >
                {copied === 'code' ? <CheckCircle2 size={11} /> : <Copy size={11} />}
                {copied === 'code' ? '已复制' : '复制'}
              </button>
            </div>

            <p className="mt-5 text-[12px] text-mist-300">邀请链接</p>
            <div className="mt-1.5 flex gap-2">
              <div className="min-w-0 flex-1 truncate rounded-lg border border-[#232a38] bg-black/30 px-3 py-2 font-mono text-[11px] text-mist-300">
                {data.link}
              </div>
              <button
                onClick={() => copy(data.link, 'link')}
                className="flex items-center gap-1 rounded-lg brand-gradient px-3 py-2 text-[11.5px] font-medium text-white"
              >
                <Share2 size={11} /> {copied === 'link' ? '已复制' : '复制'}
              </button>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-mist-400">
              好友通过该链接注册后：你得 {data.reward.inviter} 积分，好友额外得 {data.reward.invitee} 积分。
            </p>
          </div>
        </div>

        {/* 统计 */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">已邀请</span>
              <Users size={13} className="text-brand-400" />
            </div>
            <p className="mt-1.5 font-display text-[26px] font-bold leading-none text-white">{data.total}</p>
            <p className="mt-1 font-mono text-[10.5px] text-mist-400">人</p>
          </div>

          <div className="card p-4">
            <p className="text-[11.5px] text-mist-400">累计获得</p>
            <p className="mt-1.5 font-display text-[26px] font-bold leading-none text-gold-400">
              {data.total * data.reward.inviter}
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-mist-400">积分</p>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-5 card overflow-hidden">
        <div className="border-b border-[#1e2432] px-4 py-3">
          <h2 className="text-[13px] font-semibold text-mist-200">邀请记录</h2>
        </div>
        {data.invited.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-mist-400">还没有邀请记录，把链接发给朋友吧</p>
        ) : (
          <div className="divide-y divide-[#141922]">
            {data.invited.map((u, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#1b2230] text-[11px] text-mist-300">
                    {(u.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-[12.5px] text-mist-200">{u.name}</p>
                    <p className="font-mono text-[10px] text-mist-400">{u.email}</p>
                  </div>
                </div>
                <span className="text-[11px] text-mist-400">{fmtTime(u.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
