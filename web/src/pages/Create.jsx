import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Users, Mountain, CheckSquare, Sparkles, ImagePlus, X, Send,
  Loader2, Play, RefreshCw, AlertTriangle, Film, Image as ImageIcon, ChevronDown, Zap, Sliders,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast, Modal } from '../components/ui.jsx';
import QueueDrawer from '../components/QueueDrawer.jsx';
import ParamsPanel, { buildExtra, PARAM_DEFAULTS } from '../components/ParamsPanel.jsx';

const IDEAS = [
  '国风少女：汉服少女立于桃花树下，花瓣纷飞，电影感光效',
  '赛博都市：雨夜霓虹街道，机甲少年回眸，赛博朋克风格',
  '水墨山水：云雾缭绕的黄山奇松，水墨晕染，大面积留白',
  '柴犬侦探：戴圆框眼镜的柴犬，复古英伦风插画，暖色调',
];

const STORE_KEY = 'xm_projects';

export default function Create() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [projects, setProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  });
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState('');

  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [size, setSize] = useState('16:9');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [modelOpen, setModelOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [params, setParams] = useState({ ...PARAM_DEFAULTS });
  const [summary, setSummary] = useState(null);

  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const cost = 10 + 2 * duration;

  /* ---------- 项目 ---------- */
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(projects));
  }, [projects]);

  const addProject = () => {
    const name = window.prompt('请输入项目名称（必填）', '');
    if (!name?.trim()) return;
    const p = { id: 'p_' + Date.now(), name: name.trim(), createdAt: Date.now() };
    setProjects((list) => [p, ...list]);
    setActive(p.id);
    toast('项目已创建', 'ok');
  };

  const removeProject = (e, id) => {
    e.stopPropagation();
    if (!window.confirm('确认删除这个项目？')) return;
    setProjects((list) => list.filter((p) => p.id !== id));
    if (active === id) setActive(null);
  };

  const filtered = projects.filter((p) => !query || p.name.includes(query));

  /* ---------- 任务 ---------- */
  const loadJobs = useCallback(async () => {
    try {
      const out = await api.jobs({ pageSize: 18 });
      setJobs(out.jobs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // 账号池额度（顶栏与底部提示共用）
  useEffect(() => {
    let alive = true;
    const load = () => api.accounts()
      .then((d) => { if (alive) setSummary(d.summary); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // 有运行中的任务就轮询
  useEffect(() => {
    const running = jobs.some((j) => ['queued', 'processing'].includes(j.status));
    if (!running) return undefined;
    pollRef.current = setTimeout(async () => {
      const next = await Promise.all(
        jobs.map(async (j) => {
          if (!['queued', 'processing'].includes(j.status)) return j;
          try { return (await api.job(j.id)).job; } catch { return j; }
        })
      );
      setJobs(next);
      if (next.some((j) => ['queued', 'processing'].includes(j.status)) === false) refresh();
    }, 2500);
    return () => clearTimeout(pollRef.current);
  }, [jobs, refresh]);

  /* ---------- 上传 ---------- */
  const onPick = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 3) return toast('最多 3 张参考图', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((r) => [...r, ...out.files].slice(0, 3));
      toast('图片已上传', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ---------- 生成 ---------- */
  const generate = async () => {
    if (prompt.trim().length < 2) return toast('请先输入提示词并选择模型', 'error');
    if ((user?.credits ?? 0) < cost) return toast(`积分不足，本次需要 ${cost}`, 'error');
    setBusy(true);
    try {
      await api.createVideo({
        prompt: prompt.trim(),
        duration,
        size,
        images: refs.map((r) => r.url),
        extra: buildExtra(params),
      });
      setPrompt('');
      setRefs([]);
      await loadJobs();
      refresh();
      toast('任务已加入队列', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const shown = jobs.filter((j) => {
    if (filter === 'done') return j.status === 'completed';
    return true;
  });

  const clearFailed = async () => {
    const failed = jobs.filter((j) => j.status === 'failed');
    if (!failed.length) return toast('没有失败的任务', 'error');
    if (!confirm(`清除 ${failed.length} 条失败任务？`)) return;
    try {
      await Promise.all(failed.map((j) => api.deleteJob(j.id)));
      setJobs((l) => l.filter((j) => j.status !== 'failed'));
      toast('已清理失败任务', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- 项目栏 ---------------- */}
      <aside className="hidden w-[212px] shrink-0 flex-col border-r border-[#171c26] lg:flex">
        <div className="px-3 pb-2 pt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-mist-200">项目</span>
          </div>
          <p className="mb-2 text-[9.5px] leading-snug text-mist-400/70">
            (右键/长按 改名 / 新建子项目 / 删除)
          </p>
          <div className="flex flex-nowrap gap-1">
            <RailBtn icon={Users} label="角色库" />
            <RailBtn icon={Mountain} label="场景库" />
            <RailBtn icon={CheckSquare} label="批量" />
          </div>

          <button
            onClick={addProject}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white py-2 text-[13px] font-semibold text-[#0a0d16] transition hover:bg-mist-100"
          >
            <Plus size={14} /> 新建项目
          </button>

          <div className="relative mt-2">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目 / 关键词"
              className="h-8 w-full rounded-lg border border-[#1e2432] bg-ink-850 pl-7 pr-2 text-[11.5px] text-mist-200 outline-none placeholder:text-mist-400/70 focus:border-brand-500/40"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {filtered.length === 0 ? (
            <p className="mt-16 text-center text-[11.5px] leading-relaxed text-mist-400">
              还没有项目
              <br />
              点击上方按钮创建
            </p>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => setActive(p.id)}
                className={clsx(
                  'group mb-0.5 flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-[12px] transition',
                  active === p.id ? 'bg-[#141a26] text-white' : 'text-mist-300 hover:bg-[#10141d]'
                )}
              >
                <span className="truncate">{p.name}</span>
                <button
                  onClick={(e) => removeProject(e, p.id)}
                  className="opacity-0 transition group-hover:opacity-100"
                >
                  <X size={11} className="text-mist-400 hover:text-rose-400" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ---------------- 主区 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶部筛选 */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-1.5">
            {[
              ['all', '全部'],
              ['done', '已完成'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={clsx(
                  'rounded-full px-3 py-1.5 text-[12px] transition',
                  filter === k
                    ? 'bg-[#182030] text-white'
                    : 'text-mist-400 hover:text-mist-200'
                )}
              >
                {label}
                {k === 'done' && <span className="ml-1 text-brand-400">✓</span>}
              </button>
            ))}
            <button
              onClick={clearFailed}
              className="rounded-full px-3 py-1.5 text-[12px] text-mist-400 transition hover:text-rose-400"
            >
              清除失败
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-mist-400">当前: 全部</span>
            <button onClick={loadJobs} className="text-mist-400 transition hover:text-brand-300">
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {shown.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center pb-10">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[#222a38] bg-[#0e1320]">
                <Sparkles size={22} className="text-brand-400" />
              </div>
              <h3 className="mt-4 text-[15px] font-medium text-mist-100">输入提示词开始创作</h3>
              <p className="mt-1.5 text-[12.5px] text-mist-400">
                支持文生图、图生视频、参考图融合、首尾帧视频，多模型可选
              </p>

              <p className="mt-7 text-[11.5px] text-mist-400/80">没有灵感？点一个试试</p>
              <div className="mt-3 flex w-full max-w-[460px] flex-col gap-2">
                {IDEAS.map((idea) => (
                  <button
                    key={idea}
                    onClick={() => setPrompt(idea)}
                    className="rounded-full border border-[#1e2432] bg-[#0d1119]/70 px-4 py-2 text-left text-[11.5px] text-mist-300 transition hover:border-brand-500/40 hover:text-mist-100"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((j) => (
                <JobTile key={j.id} job={j} onClick={() => setPreview(j)} />
              ))}
            </div>
          )}
        </div>

        {/* ---------------- WORKBENCH ---------------- */}
        <div className="shrink-0 border-t border-[#151a25] bg-[#0a0d16]/80 px-5 pb-4 pt-2.5 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9.5px] tracking-[0.22em] text-mist-400">
              WORKBENCH · 创作工作台
            </span>
            <button
              onClick={() => setQueueOpen(true)}
              className="rounded-full bg-brand-400 px-3 py-1 text-[11.5px] font-medium text-[#04211a] transition hover:bg-brand-300"
            >
              + 加入自动执行队列
            </button>
          </div>

          <div className="rounded-2xl border border-[#1e2432] bg-[#0d1119]">
            {/* 上传区 */}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-t-2xl border-b border-dashed border-[#1e2432] py-2.5 text-[12px] text-mist-400 transition hover:bg-[#10151f] hover:text-mist-200"
            >
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              拖拽图片到此处或点击 + 上传
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPick(e.target.files)} />

            {/* 输入区 */}
            <div className="flex gap-2.5 p-2.5">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#1e2432] bg-[#0f1420] text-[9px] text-mist-400 transition hover:border-brand-500/40 hover:text-brand-300"
              >
                <ImagePlus size={15} />
                图片
              </button>

              <div className="min-w-0 flex-1">
                {refs.length > 0 && (
                  <div className="mb-1.5 flex gap-1.5">
                    {refs.map((r, i) => (
                      <div key={r.url} className="relative h-10 w-10 overflow-hidden rounded-lg border border-[#232a38]">
                        <img src={r.url} alt="" className="h-full w-full object-cover" />
                        <button
                          onClick={() => setRefs((l) => l.filter((x) => x.url !== r.url))}
                          className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl bg-black/70 text-white"
                        >
                          <X size={8} />
                        </button>
                        <span className="absolute bottom-0 left-0 bg-black/60 px-1 font-mono text-[8px] text-white">
                          @图{i + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
                  }}
                  rows={2}
                  placeholder="描述你想生成的画面，输入 @ 来引用你上传的图片"
                  className="w-full resize-none bg-transparent text-[13px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70"
                />
              </div>
            </div>

            {/* 底部操作行 */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#151a25] px-2.5 py-2">
              <button
                onClick={() => setModelOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-[#1e2432] px-2.5 py-1.5 text-[11.5px] text-mist-300 transition hover:border-[#2c3448] hover:text-white"
              >
                <Film size={12} className="text-brand-400" />
                选择模型
                <span className="text-mist-400">·</span>
                <span className="font-mono text-[10.5px] text-brand-300">muse-video</span>
                <ChevronDown size={11} />
              </button>

              <div className="flex items-center gap-1 rounded-lg border border-[#1e2432] p-0.5">
                {[5, 6, 8, 10].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={clsx(
                      'rounded-md px-2 py-1 font-mono text-[10.5px] transition',
                      duration === d ? 'bg-brand-500/15 text-brand-300' : 'text-mist-400 hover:text-mist-200'
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-[#1e2432] p-0.5">
                {['16:9', '9:16', '1:1'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={clsx(
                      'rounded-md px-2 py-1 font-mono text-[10.5px] transition',
                      size === s ? 'bg-brand-500/15 text-brand-300' : 'text-mist-400 hover:text-mist-200'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setParamsOpen(true)}
                className={clsx(
                  'flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10.5px] transition',
                  buildExtra(params)
                    ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                    : 'border-[#1e2432] text-mist-400 hover:border-[#2c3448] hover:text-mist-200'
                )}
                title="参数调整"
              >
                <Sliders size={11} /> 参数
                {buildExtra(params) && <span className="h-1 w-1 rounded-full bg-brand-400" />}
              </button>

              <div className="ml-auto flex items-center gap-3">
                <span className="font-mono text-[10.5px] tracking-wider text-mist-400">
                  {summary?.usable
                    ? <>周额度 <span className="text-brand-300">剩 {summary.weeklyLeftPct ?? '—'}%</span></>
                    : <span className="text-amber-300">未接账号</span>}
                </span>
                <button
                  onClick={generate}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-full brand-gradient px-5 py-2 text-[13px] font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  生成
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        prompt={prompt}
        duration={duration}
        size={size}
      />

      <ParamsPanel
        open={paramsOpen}
        onClose={() => setParamsOpen(false)}
        params={params}
        onChange={setParams}
      />

      <Modal open={!!preview} onClose={() => setPreview(null)} title="作品详情" width="max-w-2xl">
        {preview && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl bg-black/50">
              {preview.mediaUrl ? (
                /\.(mp4|webm|mov)/i.test(preview.mediaUrl) ? (
                  <video src={preview.mediaUrl} controls autoPlay loop className="max-h-[55vh] w-full" />
                ) : (
                  <img src={preview.mediaUrl} alt="" className="max-h-[55vh] w-full object-contain" />
                )
              ) : (
                <div className="grid h-36 place-items-center text-[12.5px] text-mist-400">
                  {preview.status === 'failed' ? preview.error : '还在生成中'}
                </div>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-mist-200">{preview.prompt}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-500">
              <span>{preview.params?.duration}s · {preview.params?.size}</span>
              <span>{preview.cost} 积分</span>
              {preview.params?.extra && <span className="truncate">{preview.params.extra}</span>}
              <span>{fmtAgo(preview.createdAt)}</span>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {preview.mediaUrl && (
                <a href={preview.mediaUrl} download>
                  <button className="rounded-lg border border-[#232a38] px-3.5 py-1.5 text-[12px] text-mist-200 hover:border-brand-500/50 hover:text-white">
                    下载
                  </button>
                </a>
              )}
              <button
                onClick={async () => {
                  if (!confirm('删除这条作品？文件会一起删掉。')) return;
                  try {
                    await api.deleteJob(preview.id);
                    setJobs((l) => l.filter((x) => x.id !== preview.id));
                    setPreview(null);
                    toast('已删除', 'ok');
                  } catch (e) {
                    toast(e.message, 'error');
                  }
                }}
                className="rounded-lg border border-rose-500/30 px-3.5 py-1.5 text-[12px] text-rose-300 hover:bg-rose-500/10"
              >
                删除
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RailBtn({ icon: Icon, label }) {
  return (
    <button className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#1e2432] px-1.5 py-1 text-[10px] text-mist-300 transition hover:border-[#2c3448] hover:text-white">
      <Icon size={10} /> {label}
    </button>
  );
}

function JobTile({ job, onClick }) {
  const running = ['queued', 'processing'].includes(job.status);
  const failed = job.status === 'failed';
  const isVideo = /\.(mp4|webm|mov)/i.test(job.mediaUrl || '');

  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-xl border border-[#1a2030] bg-ink-800 text-left transition hover:border-[#2a3446]"
    >
      <div className="aspect-square w-full overflow-hidden bg-ink-900">
        {job.mediaUrl ? (
          isVideo ? (
            <video src={job.mediaUrl} muted loop className="h-full w-full object-cover" />
          ) : (
            <img src={job.mediaUrl} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="grid h-full place-items-center px-2">
            {running ? (
              <div className="flex flex-col items-center gap-1.5 text-[11px] text-brand-400">
                <Loader2 size={16} className="animate-spin" />
                {job.progress || 0}%
              </div>
            ) : failed ? (
              <AlertTriangle size={16} className="text-rose-400" />
            ) : (
              <ImageIcon size={16} className="text-mist-400" />
            )}
          </div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <p className="line-clamp-1 text-[11.5px] text-mist-300">{job.prompt}</p>
        <p className="mt-0.5 font-mono text-[9.5px] text-mist-400">
          {job.params?.duration}s · {job.params?.size} · {fmtAgo(job.createdAt)}
        </p>
      </div>
    </button>
  );
}
