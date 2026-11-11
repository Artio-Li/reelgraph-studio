import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Heart, Play, ArrowUpRight, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';

/* 逆向自目标站首页的 AI 要闻（静态内容位，可在后台配置） */
const BRIEFING = [
  { tag: '芯片动脉', text: '基元律动发布 NeoHorse-1.5-Flash Preview，Agent 模型 RSI 进入第二轮迭代' },
  { tag: '芯片动脉', text: '英伟达 CEO 黄仁勋承认出舱全员何道歉，官方已启动内部紧急调查' },
  { tag: '行业研究', text: '行业分析显示终端侧 AI 发展进入新阶段，从单点应用走向智能体体验' },
  { tag: '腾讯', text: '腾讯混元跻身头部开源模型，实测 Hy4 搭配 WorkBuddy 多模态 Agent 交付能力优异' },
  { tag: '阿里巴巴', text: '阿里发布千问办公 2.0，推出首个支持多人与 Agent 协作的 Team Agent' },
  { tag: '奔驰宝马', text: '奔驰宝马官宣终止 L3 级自动驾驶研发，称其使用体验不及现有 L2 系统' },
  { tag: '开源行业', text: 'AI 可完整复现 8 万 Star 开源公司，包揽写代码派任务查 Bug 等全流程工作' },
  { tag: '基元律动', text: '基元律动发布 NeoHorse-1.5-Flash Preview，Agent 模型 RSI 进入第二轮迭代' },
];

export default function Home() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [works, setWorks] = useState([]);
  const [hero, setHero] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.jobs({ status: 'completed', pageSize: 9 })
      .then((out) => {
        setWorks(out.jobs || []);
        setHero((out.jobs || []).find((j) => j.mediaUrl) || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="mx-auto max-w-[1320px] px-6 pb-16 pt-4">
      {/* ---------------- 上半：AI 要闻 + 实时渲染 ---------------- */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* AI 要闻 */}
        <section className="rounded-2xl border border-[#1a2030] bg-[#0c1017]/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-wide text-white">
              AI 要闻
            </h2>
            <span className="font-mono text-[11px] tracking-wider text-mist-400">{dateStr}</span>
          </div>

          <div className="divide-y divide-[#161b26]">
            {BRIEFING.map((item, i) => (
              <div key={i} className="group flex items-center gap-3 py-[9px]">
                <span className="shrink-0 rounded-full border border-[#232a38] px-2 py-[3px] text-[10px] text-mist-300">
                  {item.tag}
                </span>
                <p className="truncate text-[12.5px] leading-relaxed text-mist-200 transition group-hover:text-white">
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2 border-t border-[#151a25] pt-3">
            <span className="h-1 w-1 rounded-full bg-brand-400 pulse-dot" />
            <span className="font-mono text-[9.5px] tracking-[0.28em] text-mist-400">
              LIVE · AI DAILY BRIEFING
            </span>
          </div>
        </section>

        {/* 实时渲染 */}
        <section className="glow-frame relative overflow-hidden rounded-2xl border border-brand-500/20 bg-[#070b12]">
          <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-black/50 px-2.5 py-1 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 pulse-dot" />
            <span className="text-[10.5px] text-mist-200">实时渲染</span>
            <span className="font-mono text-[10px] tracking-wider text-brand-300">GPU ONLINE</span>
          </div>

          <div className="relative aspect-[16/10] w-full">
            {hero?.mediaUrl ? (
              /\.(mp4|webm|mov)/i.test(hero.mediaUrl) ? (
                <video
                  src={hero.mediaUrl}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <img src={hero.mediaUrl} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(120%_100%_at_50%_0%,#0f3a33_0%,#08131a_55%,#05080e_100%)]">
                {/* 无作品时的霓虹屏占位 */}
                <div className="absolute inset-x-[8%] top-[12%] h-[62%] rounded-[26px] border border-brand-400/40 shadow-[0_0_60px_-10px_rgba(79,227,193,.55),inset_0_0_40px_rgba(79,227,193,.12)]">
                  <div className="absolute inset-x-0 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-brand-300/90 to-transparent" />
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="text-center">
                      <p className="font-display text-[13px] tracking-[0.3em] text-brand-300/80">CINEMA</p>
                      <p className="mt-1 font-mono text-[10px] tracking-[0.24em] text-mist-400">
                        一句话高空 · LED 四季全息
                      </p>
                    </div>
                  </div>
                </div>
                {/* 人形剪影 */}
                <div className="absolute bottom-0 left-1/2 h-[46%] w-[16%] -translate-x-1/2 rounded-t-[40%] bg-black/80" />
              </div>
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent" />

            <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
              <p className="font-mono text-[10px] tracking-[0.16em] text-white/55">
                SHOT 01 · 一句话高空 · LED 四季全息
              </p>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={clsx(
                      'h-[3px] rounded-full transition-all',
                      i === 0 ? 'w-6 bg-brand-400' : 'w-4 bg-white/25'
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 backdrop-blur">
              <span className="text-[10px] text-brand-300">◆</span>
              <span className="text-[10.5px] text-white/80">CINEMA 4K · 四季自动轮播</span>
            </div>
          </div>
        </section>
      </div>

      {/* ---------------- 作品广场 ---------------- */}
      <section className="mt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-[30px] font-bold leading-none tracking-tight text-white">
            作品广场
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-mist-400">
              共 <span className="font-mono text-mist-200">{works.length}</span> 件 · 点击 ♥ 点赞
            </span>
            <button
              onClick={() => nav('/create')}
              className="flex items-center gap-1.5 rounded-full border border-[#232a38] bg-ink-850 px-4 py-2 text-[12.5px] text-mist-200 transition hover:border-brand-500/50 hover:text-white"
            >
              <Upload size={13} /> 上传作品
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="shimmer aspect-[4/5] rounded-2xl" />
            ))}
          </div>
        ) : works.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-[#1a2030] bg-[#0c1017]/50 py-20">
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-ink-800 text-brand-400">
                <Sparkles size={20} />
              </div>
              <p className="text-[14px] font-medium text-mist-200">广场还是空的</p>
              <p className="mt-1 text-[12.5px] text-mist-400">生成第一条作品，它会出现在这里</p>
              <button
                onClick={() => nav('/create')}
                className="mt-4 rounded-full brand-gradient px-5 py-2 text-[13px] font-medium text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110"
              >
                开始创作
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {works.map((w) => (
              <WorkTile key={w.id} job={w} onClick={() => nav('/works')} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkTile({ job, onClick }) {
  const isVideo = /\.(mp4|webm|mov)/i.test(job.mediaUrl || '');
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-[#1a2030] bg-ink-800 text-left transition hover:border-[#2a3446]"
    >
      <div className="aspect-[4/5] w-full overflow-hidden bg-ink-900">
        {job.mediaUrl ? (
          isVideo ? (
            <video
              src={job.mediaUrl}
              muted
              loop
              playsInline
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => e.currentTarget.pause()}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <img
              src={job.mediaUrl}
              alt=""
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className="grid h-full place-items-center text-[12px] text-mist-400">无预览</div>
        )}

        {isVideo && (
          <span className="absolute left-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
            <Play size={10} fill="currentColor" />
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 p-3">
        <p className="line-clamp-2 flex-1 text-[12.5px] leading-snug text-mist-300">{job.prompt}</p>
        <Heart size={13} className="mt-0.5 shrink-0 text-mist-400 transition group-hover:text-brand-400" />
      </div>
    </button>
  );
}
