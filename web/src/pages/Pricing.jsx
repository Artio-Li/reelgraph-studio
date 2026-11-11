import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const IMAGE_MODELS = [
  { name: 'muse-image', id: 'muse-image', tiers: [{ label: '标准', price: 5 }] },
];

export default function Pricing() {
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState('video');

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  const p = meta?.price || { videoBase: 10, videoPerSecond: 2, image: 5 };
  const durations = meta?.durations || [5, 6, 8, 10];

  const videoRows = durations.map((d) => ({
    model: 'Muse Video',
    id: 'muse-video',
    tier: `${d} 秒`,
    price: p.videoBase + p.videoPerSecond * d,
  }));

  const rows = tab === 'video' ? videoRows : IMAGE_MODELS.flatMap((m) =>
    m.tiers.map((t) => ({ model: 'Muse Image', id: m.id, tier: t.label, price: t.price }))
  );

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-20 pt-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-white">价目表</h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">仅展示已上线并启用的模型，按 1 元 = 10 积分折算。</p>

      <div className="mt-6 flex items-center gap-3">
        <h2 className="text-[15px] font-semibold text-mist-100">
          {tab === 'video' ? '视频' : '图片'}
        </h2>
        <span className="text-[11.5px] text-mist-400">{rows.length} 个档位</span>
        <div className="ml-2 flex gap-1 rounded-full border border-[#1e2432] p-0.5">
          {[['video', '视频'], ['image', '图片']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                'rounded-full px-3 py-1 text-[11.5px] transition ' +
                (tab === k ? 'bg-[#182030] text-white' : 'text-mist-400 hover:text-mist-200')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11.5px] text-mist-400">
        峰谷计价：北京时间工作日 09:00–12:00、14:00–18:00 为峰时，其余时段及周末为谷时。
      </p>

      <div className="mt-4 overflow-hidden rounded-xl border border-[#1a2030]">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#1a2030] text-[11px] text-mist-400">
              <th className="px-4 py-2.5 font-normal">模型</th>
              <th className="px-4 py-2.5 font-normal">档位</th>
              <th className="px-4 py-2.5 text-right font-normal">价格</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141922]">
            {rows.map((r, i) => (
              <tr key={i} className="transition hover:bg-[#0e131c]">
                <td className="px-4 py-3">
                  <span className="text-[12.5px] text-mist-200">{r.model}</span>
                  <span className="ml-2 font-mono text-[11px] text-mist-400">{r.id}</span>
                </td>
                <td className="px-4 py-3 text-[12px] text-mist-300">{r.tier}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] text-mist-100">
                  {r.price} 积分
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-mist-400">
        视频消耗 = 基础价 {p.videoBase} + 每秒 {p.videoPerSecond} 积分 × 时长；任务失败自动退还积分。
        实际价格以后台配置为准。
      </p>
    </div>
  );
}
