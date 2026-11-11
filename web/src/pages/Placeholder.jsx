import { useNavigate } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';

/**
 * 目标站模块占位页：保持导航完整、信息对齐，功能分批填充。
 */
export default function Placeholder({ title, sub, eyebrow, desc }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-20 pt-6">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-white">{title}</h1>
      {sub && <p className="mt-1.5 text-[12.5px] text-mist-400">{sub}</p>}

      <div className="mt-6 grid min-h-[420px] place-items-center rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60">
        <div className="max-w-md px-6 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-[#222a38] bg-[#0e1320] text-brand-400">
            <Construction size={22} />
          </div>
          <p className="text-[14px] font-medium text-mist-200">该模块正在复刻中</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-mist-400">{desc}</p>
          <button
            onClick={() => nav('/create')}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[#232a38] px-4 py-2 text-[12.5px] text-mist-200 transition hover:border-brand-500/50 hover:text-white"
          >
            先去创作台 <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
