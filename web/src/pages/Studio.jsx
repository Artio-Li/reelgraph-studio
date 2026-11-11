import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, ImagePlus, X, Download, Play, RefreshCw, AlertTriangle, Clock,
  Video, Wand2, Loader2, CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Field, Textarea, useToast, Spinner } from '../components/ui.jsx';

const IDEAS = [
  '雨夜的东京街头，霓虹灯在积水里碎成一片，镜头缓慢推近撑伞的少女',
  '雪山之巅，云雾翻涌，一只白鹰掠过镜头，光线穿透云层',
  '古风庭院，红衣女子回眸，落花随风飘过，浅景深',
  '未来都市的清晨，飞行器穿梭于高塔之间，金色晨光斜照',
  '咖啡杯里的热气缓缓升起，窗外雪落，慢镜头特写',
];

export default function Studio() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [size, setSize] = useState('16:9');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);
  const [recent, setRecent] = useState([]);
  const [accCount, setAccCount] = useState(null);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const cost = useMemo(() => {
    if (!meta) return 0;
    return meta.price.videoBase + meta.price.videoPerSecond * duration;
  }, [meta, duration]);

  const loadRecent = useCallback(async () => {
    try {
      const out = await api.jobs({ pageSize: 6 });
      setRecent(out.jobs.filter((j) => j.type === 'video'));
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      if (!m.sizes.includes(size)) setSize(m.sizes[0]);
      if (!m.durations.includes(duration)) setDuration(m.durations[0]);
    }).catch(() => toast('读取平台配置失败', 'error'));
    loadRecent();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 账号池空时提醒用户先去导入
  useEffect(() => {
    api.accounts()
      .then((o) => setAccCount(o.accounts.filter((a) => a.status !== 'missing').length))
      .catch(() => setAccCount(null));
  }, []);

  // 轮询当前任务
  useEffect(() => {
    if (!active || ['completed', 'failed'].includes(active.status)) return;
    pollRef.current = setTimeout(async () => {
      try {
        const { job } = await api.job(active.id);
        setActive(job);
        if (job.status === 'completed') {
          toast('生成完成', 'ok');
          refresh();
          loadRecent();
        } else if (job.status === 'failed') {
          toast(job.error || '生成失败，积分已退还', 'error');
          refresh();
          loadRecent();
        }
      } catch { /* 继续轮询 */ }
    }, 2500);
    return () => clearTimeout(pollRef.current);
  }, [active, refresh, loadRecent, toast]);

  const onPickFiles = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 3) {
      toast('最多 3 张参考图', 'error');
      return;
    }
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((r) => [...r, ...out.files].slice(0, 3));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (prompt.trim().length < 2) return toast('先写点画面描述', 'error');
    if ((user?.credits ?? 0) < cost) return toast(`积分不足，本次需要 ${cost}`, 'error');
    setBusy(true);
    try {
      const { job } = await api.createVideo({
        prompt: prompt.trim(),
        duration,
        size,
        images: refs.map((r) => r.url),
      });
      setActive(job);
      refresh();
      loadRecent();
    } catch (e) {
      toast(e.message, 'error');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const running = active && ['queued', 'processing'].includes(active.status);

  return (
    <div className="grid gap-5 p-5 lg:p-7 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      {/* ---------------- 创作表单 ---------------- */}
      <section className="card h-fit p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Video size={16} className="text-brand-400" /> 视频生成
          </h2>
          <Badge tone="brand">muse-video</Badge>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-mist-300">画面描述</span>
              <button
                onClick={() => setPrompt(IDEAS[Math.floor(Math.random() * IDEAS.length)])}
                className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300"
              >
                <Wand2 size={11} /> 来点灵感
              </button>
            </div>
            <Textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述主体、动作、环境、镜头语言。例如：雨后巷口，女孩撑伞回头，慢镜头，浅景深，暖色调"
              maxLength={1200}
            />
            <div className="mt-1 flex justify-between text-[11px] text-ink-500">
              <span>支持中英文混写，越具体的镜头语言成片越稳</span>
              <span>{prompt.length}/1200</span>
            </div>
          </div>

          {/* 参考图 */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-mist-300">
              参考图 <span className="text-ink-500">（可选，首图作起始帧）</span>
            </span>
            <div className="grid grid-cols-4 gap-2">
              {refs.map((r) => (
                <div key={r.url} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-700">
                  <img src={r.url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => setRefs((list) => list.filter((i) => i.url !== r.url))}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {refs.length < 3 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-600 text-[10.5px] text-mist-400 transition hover:border-brand-500/60 hover:text-brand-400"
                >
                  {uploading ? <Spinner size={14} /> : <ImagePlus size={16} />}
                  {uploading ? '上传中' : '添加'}
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </div>

          {/* 时长 */}
          <Field label="时长">
            <div className="flex gap-2">
              {(meta?.durations || [5]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={clsx(
                    'flex-1 rounded-xl border py-2 text-[13px] font-medium transition',
                    duration === d
                      ? 'border-brand-500/60 bg-brand-500/12 text-brand-300'
                      : 'border-ink-700 text-mist-400 hover:border-ink-600 hover:text-mist-200'
                  )}
                >
                  {d}s
                </button>
              ))}
            </div>
          </Field>

          {/* 画幅 */}
          <Field label="画幅">
            <div className="flex gap-2">
              {(meta?.sizes || ['16:9']).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={clsx(
                    'flex-1 rounded-xl border py-2 text-[12.5px] font-medium transition',
                    size === s
                      ? 'border-brand-500/60 bg-brand-500/12 text-brand-300'
                      : 'border-ink-700 text-mist-400 hover:border-ink-600 hover:text-mist-200'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex items-center justify-between rounded-xl bg-ink-900 px-3.5 py-3">
            <span className="text-[12.5px] text-mist-400">预计消耗</span>
            <span className="text-[15px] font-semibold tabular-nums text-amber-300">{cost} 积分</span>
          </div>

          <Button size="lg" className="w-full" loading={busy || running} onClick={submit} disabled={running}>
            {running ? '生成中…' : <><Sparkles size={16} /> 开始生成</>}
          </Button>
          <p className="text-center text-[11px] text-ink-500">
            单条 5–10 秒，通常 1–3 分钟出片，失败自动退还积分
          </p>
        </div>
      </section>

      {/* ---------------- 结果区 ---------------- */}
      <section className="min-w-0 space-y-4">
        {active ? <ResultPanel job={active} /> : <GuidePanel accountCount={accCount} />}

        {recent.length > 0 && (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
                <Clock size={14} className="text-mist-400" /> 最近生成
              </h3>
              <a href="/works" className="text-[12px] text-brand-400 hover:text-brand-300">全部作品 →</a>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {recent.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setActive(j)}
                  className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
                >
                  {j.mediaUrl ? (
                    <video src={j.mediaUrl} muted className="h-full w-full object-cover opacity-80 group-hover:opacity-100" />
                  ) : (
                    <div className="grid h-full place-items-center text-[10px] text-ink-500">
                      {j.status === 'failed' ? '失败' : j.status === 'completed' ? '无预览' : '生成中'}
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left text-[10px] text-white/85">
                    {j.prompt.slice(0, 16)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function GuidePanel({ accountCount }) {
  const steps = [
    { n: '01', t: '导入 Muse 账号', d: '粘贴一次 Cookie，账号进池后自动被调度' },
    { n: '02', t: '写清镜头语言', d: '主体 + 动作 + 环境 + 运镜，越具体越稳' },
    { n: '03', t: '出片并下载', d: '1–3 分钟成片，作品库可随时回看' },
  ];
  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden px-6 py-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand-600/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-44 w-44 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400">Workspace</p>
          <h3 className="mt-2 text-[22px] font-semibold tracking-tight text-white">
            三步做出一条<span className="brand-text"> 能用的片子</span>
          </h3>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-mist-400">
            平台把 Muse 网页端能力封成了标准接口，账号池在后台轮转，你只管描述画面。
          </p>
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-ink-700 bg-ink-900/70 p-3.5">
              <span className="text-[11px] font-semibold tabular-nums text-brand-400">{s.n}</span>
              <p className="mt-1 text-[13px] font-medium text-mist-200">{s.t}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">{s.d}</p>
            </div>
          ))}
        </div>

        {accountCount === 0 && (
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <div>
                <p className="text-[13px] font-medium text-amber-200">还没有可用账号</p>
                <p className="mt-0.5 text-[11.5px] text-amber-200/70">
                  生成前必须先导入一个 muse.ai 账号的 Cookie，否则上游会直接拒绝
                </p>
              </div>
            </div>
            <a
              href="/accounts"
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 transition hover:bg-amber-300"
            >
              去导入 →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultPanel({ job, compact }) {  if (!job) {
    return (
      <div className={clsx('card grid place-items-center', compact ? 'h-64' : 'h-[420px]')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 text-mist-400">
            <Play size={22} />
          </div>
          <div>
            <p className="text-[14px] font-medium text-mist-200">还没有生成结果</p>
            <p className="mt-1 text-[12px] text-mist-400">写好描述，点「开始生成」</p>
          </div>
        </div>
      </div>
    );
  }

  const running = ['queued', 'processing'].includes(job.status);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';
  const url = job.mediaUrl || job.result?.url;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {running && <Loader2 size={14} className="animate-spin text-brand-400" />}
          {done && <CheckCircle2 size={14} className="text-emerald-400" />}
          {failed && <AlertTriangle size={14} className="text-rose-400" />}
          <span className="truncate text-[12.5px] text-mist-300">{job.prompt}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={done ? 'ok' : failed ? 'error' : 'brand'}>
            {done ? '已完成' : failed ? '失败' : job.status === 'processing' ? '生成中' : '排队中'}
          </Badge>
          {url && (
            <a
              href={url}
              download
              className="rounded-lg border border-ink-600 p-1.5 text-mist-300 transition hover:border-ink-500 hover:text-white"
              title="下载"
            >
              <Download size={13} />
            </a>
          )}
        </div>
      </div>

      <div className="relative bg-black/40">
        {done && url ? (
          /\.(mp4|webm|mov)/i.test(url) ? (
            <video src={url} controls autoPlay loop playsInline className="max-h-[62vh] w-full object-contain" />
          ) : (
            <img src={url} alt="" className="max-h-[62vh] w-full object-contain" />
          )
        ) : (
          <div className={clsx('relative grid place-items-center overflow-hidden', compact ? 'h-56' : 'h-[380px]')}>
            {running ? (
              <div className="w-full max-w-xs px-6">
                <div className="mb-3 flex items-center justify-between text-[12px] text-mist-400">
                  <span>正在渲染</span>
                  <span className="tabular-nums">{job.progress || 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full brand-gradient transition-all duration-700"
                    style={{ width: `${Math.max(6, job.progress || 0)}%` }}
                  />
                </div>
                <p className="mt-3 text-center text-[11px] text-ink-500">
                  上游浏览器正在跑，别关页面
                </p>
              </div>
            ) : failed ? (
              <div className="max-w-sm px-6 text-center">
                <AlertTriangle size={22} className="mx-auto mb-2 text-rose-400" />
                <p className="text-[13px] text-rose-300">{job.error || '生成失败'}</p>
                {job.refunded && <p className="mt-1 text-[11.5px] text-ink-500">积分已自动退还</p>}
              </div>
            ) : (
              <RefreshCw size={20} className="text-ink-500" />
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[11.5px] text-ink-500">
        <span>{job.params?.duration || 5}s · {job.params?.size || '16:9'}</span>
        <span>消耗 {job.cost} 积分</span>
        {job.createdAt && <span>{fmtAgo(job.createdAt)}</span>}
        {job.accountId && <span className="truncate">账号 {job.accountId.slice(0, 10)}</span>}
      </div>
    </div>
  );
}
