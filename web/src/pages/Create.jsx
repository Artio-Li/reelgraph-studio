import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Search, Sparkles, ImagePlus, X, Send, Loader2, Play, RefreshCw,
  AlertTriangle, Film, Image as ImageIcon, ChevronDown, Sliders, FolderPlus,
  Clapperboard, Bot, Workflow, Trash2, Download, Folder, Edit3, Eye,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Modal, Select, useToast } from '../components/ui.jsx';
import QueueDrawer from '../components/QueueDrawer.jsx';
import ParamsPanel, { buildExtra, PARAM_DEFAULTS } from '../components/ParamsPanel.jsx';

const IDEAS = [
  { tag: '纪实人像', text: '清晨街角咖啡店窗边，25岁短发女生捧着热拿铁望向窗外细雨，玻璃水珠滑落，真实手机手持微动，自然散射光' },
  { tag: '电影氛围', text: '雨夜霓虹十字路口，穿深色风衣的青年撑透明雨伞缓步走过斑马线，湿润柏油路面映射青橙光影，35mm定焦浅景深' },
  { tag: '商业特写', text: '极简暗色岩石台面上，透明香水瓶被一束暖色侧逆光穿透，细密水雾在空气中缓慢升腾，100mm微距镜头缓缓推近' },
  { tag: '东方美学', text: '云雾缭绕的徽派古村清晨，青石板巷尽头灯笼微亮，远处山峦如水墨晕染，长焦固定机位留白构图' },
];

const PROJECT_COLORS = ['#4fe3c1', '#38c8f0', '#a78bfa', '#f59e0b', '#f43f5e'];
const LEGACY_PROJECTS_KEY = 'xm_projects';

export default function Create() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [projQuery, setProjQuery] = useState('');

  // 创作模式：video | image
  const [createMode, setCreateMode] = useState('video');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [size, setSize] = useState('16:9');
  const [videoModel, setVideoModel] = useState('muse-video');
  const [videoEngines, setVideoEngines] = useState([{ id: 'muse-video', name: 'Muse Video (账号池)' }]);
  const [imageProvider, setImageProvider] = useState('muse');
  const [resolution, setResolution] = useState('1K');
  const [aiProviders, setAiProviders] = useState([]);

  const [refs, setRefs] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [jobs, setJobs] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all'); // all | video | image | done
  const [jobSearch, setJobSearch] = useState('');
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [params, setParams] = useState({ ...PARAM_DEFAULTS });
  const [summary, setSummary] = useState(null);
  const [pricing, setPricing] = useState({ videoBase: 10, videoPerSecond: 2, image: 5 });

  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const cost = createMode === 'video'
    ? pricing.videoBase + pricing.videoPerSecond * duration
    : pricing.image;

  /* ---------- 加载元信息、AI Provider 与项目夹 ---------- */
  const loadProjects = useCallback(async () => {
    try {
      const out = await api.projects();
      let list = out.projects || [];
      // 自动迁移旧版浏览器本地项目
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_PROJECTS_KEY) || '[]');
        if (Array.isArray(legacy) && legacy.length && !list.length) {
          for (const item of legacy.slice(0, 10)) {
            if (item?.name) await api.createProject({ name: String(item.name).slice(0, 50) });
          }
          localStorage.removeItem(LEGACY_PROJECTS_KEY);
          list = (await api.projects()).projects || [];
        }
      } catch { /* ignore */ }
      setProjects(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadProjects();
    api.meta().then((m) => {
      if (m.price) setPricing(m.price);
      if (m.videoEngines?.length) setVideoEngines(m.videoEngines);
    }).catch(() => {});
    api.geminiMeta().then((gm) => {
      const enabled = Object.values(gm?.providers || {}).filter((p) => p.enabled);
      setAiProviders(enabled);
      if (enabled.length) setImageProvider(gm.defaultProvider || enabled[0].id);
    }).catch(() => {});
  }, [loadProjects]);

  // 接收来自 AI 创作台或命令面板的草稿流转
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('rg_create_draft') || 'null');
      if (draft) {
        localStorage.removeItem('rg_create_draft');
        if (draft.mode) setCreateMode(draft.mode);
        if (draft.prompt) setPrompt(draft.prompt);
        if (draft.duration) setDuration(Number(draft.duration));
        if (draft.size) setSize(draft.size);
        if (draft.refUrl) setRefs([{ url: draft.refUrl }]);
      }
    } catch { localStorage.removeItem('rg_create_draft'); }
  }, []);

  /* ---------- 项目夹增删改 ---------- */
  const addProject = async () => {
    const name = window.prompt('输入新建项目夹名称', '');
    if (!name?.trim()) return;
    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    try {
      const out = await api.createProject({ name: name.trim(), color });
      setProjects((list) => [out.project, ...list]);
      setActiveProject(out.project.id);
      toast('项目夹已创建', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };

  const renameProject = async (e, proj) => {
    e.stopPropagation();
    const nextName = window.prompt('修改项目名称', proj.name);
    if (!nextName?.trim() || nextName.trim() === proj.name) return;
    try {
      await api.patchProject(proj.id, { name: nextName.trim() });
      setProjects((list) => list.map((p) => (p.id === proj.id ? { ...p, name: nextName.trim() } : p)));
      toast('已重命名', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };

  const removeProject = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('删除该项目夹？（夹内作品本身不会被删除，会回到全部列表）')) return;
    try {
      await api.deleteProject(id);
      setProjects((list) => list.filter((p) => p.id !== id));
      if (activeProject === id) setActiveProject(null);
      toast('项目夹已移除', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };

  /* ---------- 任务列表与轮询 ---------- */
  const loadJobs = useCallback(async () => {
    try {
      const q = { pageSize: 36 };
      if (activeProject) q.projectId = activeProject;
      if (typeFilter === 'video' || typeFilter === 'image') q.type = typeFilter;
      if (typeFilter === 'done') q.status = 'completed';
      if (jobSearch.trim()) q.q = jobSearch.trim();
      const out = await api.jobs(q);
      setJobs(out.jobs || []);
    } catch { /* ignore */ }
  }, [activeProject, typeFilter, jobSearch]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // URL ?job=xxx 直接打开详情弹窗
  useEffect(() => {
    const targetJobId = searchParams.get('job');
    if (!targetJobId) return;
    api.job(targetJobId).then((out) => {
      if (out?.job) setPreview(out.job);
      searchParams.delete('job');
      setSearchParams(searchParams, { replace: true });
    }).catch(() => {});
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let alive = true;
    const load = () => api.accounts()
      .then((d) => { if (alive) setSummary(d.summary); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    const running = jobs.some((j) => ['queued', 'processing'].includes(j.status));
    if (!running) return undefined;
    pollRef.current = setTimeout(async () => {
      const next = await Promise.all(
        jobs.map(async (j) => {
          if (!['queued', 'processing'].includes(j.status)) return j;
          try { return (await api.job(j.id)).job; } catch { return j; }
        }),
      );
      setJobs(next);
      if (!next.some((j) => ['queued', 'processing'].includes(j.status))) {
        refresh();
        loadProjects();
      }
    }, 2600);
    return () => clearTimeout(pollRef.current);
  }, [jobs, refresh, loadProjects]);

  /* ---------- 参考图上传（点击 + 拖拽） ---------- */
  const onPick = async (files) => {
    if (!files?.length) return;
    const maxRefs = createMode === 'video' ? 3 : 4;
    if (refs.length + files.length > maxRefs) return toast(`最多上传 ${maxRefs} 张参考图`, 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((r) => [...r, ...(out.files || [])].slice(0, maxRefs));
      toast('参考素材已就绪', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) onPick(files);
  };

  /* ---------- 提交生成 ---------- */
  const generate = async () => {
    if (prompt.trim().length < 2) return toast('请先输入画面描述提示词', 'error');
    if ((user?.credits ?? 0) < cost) return toast(`积分不足，本次需要 ${cost} 积分`, 'error');
    setBusy(true);
    try {
      if (createMode === 'video') {
        await api.createVideo({
          prompt: prompt.trim(),
          duration,
          size,
          model: videoModel,
          images: refs.map((r) => r.url),
          extra: buildExtra(params),
          projectId: activeProject,
        });
        toast('视频生成任务已加入队列', 'ok');
      } else {
        await api.createImage({
          prompt: prompt.trim(),
          size,
          provider: imageProvider,
          resolution,
          images: refs.map((r) => r.url),
          projectId: activeProject,
        });
        toast('图片生成已完成或入队', 'ok');
      }
      setPrompt('');
      setRefs([]);
      await Promise.all([loadJobs(), loadProjects()]);
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearFailed = async () => {
    const failed = jobs.filter((j) => j.status === 'failed');
    if (!failed.length) return toast('当前列表没有失败任务', 'info');
    if (!window.confirm(`确认清理 ${failed.length} 条失败记录？`)) return;
    try {
      await Promise.all(failed.map((j) => api.deleteJob(j.id)));
      setJobs((l) => l.filter((j) => j.status !== 'failed'));
      toast('已清理失败任务', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const moveJobToProject = async (jobId, targetProjId) => {
    try {
      const out = await api.patchJob(jobId, { projectId: targetProjId || null });
      setPreview(out.job);
      await Promise.all([loadJobs(), loadProjects()]);
      toast('作品归档已更新', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };

  const filteredProjects = useMemo(
    () => projects.filter((p) => !projQuery || p.name.toLowerCase().includes(projQuery.toLowerCase())),
    [projects, projQuery],
  );
  const currentProjectObj = projects.find((p) => p.id === activeProject) || null;

  return (
    <div className="flex h-full min-h-0">
      {/* ---------------- 左侧：项目归档与工具直通车 ---------------- */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-ink-700/70 bg-ink-850/45 lg:flex">
        <div className="p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Projects · 归档夹</span>
            <span className="font-mono text-[10px] text-mist-400">{projects.length}</span>
          </div>

          <button
            onClick={addProject}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-500/35 bg-brand-500/12 py-2 text-[12.5px] font-medium text-brand-300 transition hover:bg-brand-500/20"
          >
            <FolderPlus size={14} /> 新建项目夹
          </button>

          <div className="relative mt-2.5">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-400" />
            <input
              value={projQuery}
              onChange={(e) => setProjQuery(e.target.value)}
              placeholder="筛选项目夹…"
              className="h-8 w-full rounded-lg border border-ink-700 bg-ink-900/70 pl-7 pr-2 text-[11.5px] text-mist-200 outline-none placeholder:text-mist-500 focus:border-brand-500/50"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5">
          <button
            onClick={() => setActiveProject(null)}
            className={clsx(
              'flex w-full items-center justify-between rounded-xl px-3 py-2 text-[12.5px] transition',
              activeProject === null
                ? 'bg-ink-750 font-medium text-mist-100 shadow-sm'
                : 'text-mist-300 hover:bg-ink-800/70',
            )}
          >
            <span className="flex items-center gap-2">
              <Folder size={13} className="text-brand-400" />
              全部作品库
            </span>
          </button>

          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => setActiveProject(p.id)}
              onContextMenu={(e) => renameProject(e, p)}
              className={clsx(
                'group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-[12.5px] transition',
                activeProject === p.id
                  ? 'bg-ink-750 font-medium text-mist-100 shadow-sm'
                  : 'text-mist-300 hover:bg-ink-800/70',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color || '#4fe3c1' }} />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="font-mono text-[10px] text-mist-400 group-hover:hidden">{p.jobCount || 0}</span>
                <button
                  type="button"
                  title="重命名"
                  onClick={(e) => renameProject(e, p)}
                  className="hidden rounded p-0.5 text-mist-400 hover:text-mist-100 group-hover:inline-flex"
                >
                  <Edit3 size={11} />
                </button>
                <button
                  type="button"
                  title="删除项目夹"
                  onClick={(e) => removeProject(e, p.id)}
                  className="hidden rounded p-0.5 text-mist-400 hover:text-rose-400 group-hover:inline-flex"
                >
                  <X size={11} />
                </button>
              </span>
            </div>
          ))}
        </div>

        {/* 底部进阶工作流入口 */}
        <div className="space-y-1.5 border-t border-ink-700/70 p-3">
          <p className="px-1 eyebrow">Pro Workflows</p>
          <button
            onClick={() => nav('/director')}
            className="flex w-full items-center gap-2 rounded-xl border border-ink-700/80 bg-ink-900/50 px-2.5 py-2 text-left text-[11.5px] text-mist-200 transition hover:border-brand-500/40 hover:text-brand-300"
          >
            <Clapperboard size={13} className="text-brand-400" />
            <span>自动导演 · 批量短片</span>
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => nav('/gemini')}
              className="flex items-center justify-center gap-1 rounded-xl border border-ink-700/80 bg-ink-900/50 py-1.5 text-[11px] text-mist-300 transition hover:border-brand-500/40 hover:text-mist-100"
            >
              <Bot size={12} className="text-sky-400" /> AI 扩写
            </button>
            <button
              onClick={() => nav('/canvas')}
              className="flex items-center justify-center gap-1 rounded-xl border border-ink-700/80 bg-ink-900/50 py-1.5 text-[11px] text-mist-300 transition hover:border-brand-500/40 hover:text-mist-100"
            >
              <Workflow size={12} className="text-violet-400" /> 节点画布
            </button>
          </div>
        </div>
      </aside>

      {/* ---------------- 右侧主画廊与底部悬浮工作台 ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏过滤与检索 */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-700/50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              ['all', '全部素材'],
              ['video', '视频'],
              ['image', '图片'],
              ['done', '已完成 ✓'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTypeFilter(k)}
                className={clsx(
                  'rounded-full px-3 py-1 text-[12px] font-medium transition',
                  typeFilter === k
                    ? 'border border-brand-500/35 bg-brand-500/15 text-brand-300'
                    : 'border border-transparent text-mist-400 hover:bg-ink-800 hover:text-mist-200',
                )}
              >
                {label}
              </button>
            ))}

            {jobs.some((j) => j.status === 'failed') && (
              <button
                onClick={clearFailed}
                className="rounded-full px-2.5 py-1 text-[11.5px] text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-300"
              >
                清理失败项
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {currentProjectObj && (
              <Badge tone="brand">
                项目：{currentProjectObj.name}
                <button onClick={() => setActiveProject(null)} className="ml-1 hover:text-white"><X size={10} /></button>
              </Badge>
            )}
            <div className="relative hidden sm:block">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-400" />
              <input
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                placeholder="筛选提示词…"
                className="h-7 w-40 rounded-full border border-ink-700 bg-ink-900/65 pl-7 pr-2.5 text-[11.5px] text-mist-200 outline-none focus:w-52 focus:border-brand-500/50 transition-all"
              />
            </div>
            <button
              onClick={loadJobs}
              title="刷新作品列表"
              className="rounded-lg p-1.5 text-mist-400 transition hover:bg-ink-800 hover:text-brand-300"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* 作品画廊区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {jobs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8">
              <div className="grid h-15 w-15 place-items-center rounded-2xl border border-brand-500/30 bg-brand-500/10 text-brand-300 shadow-lg">
                <Sparkles size={24} />
              </div>
              <h3 className="mt-4 text-[16px] font-semibold text-mist-100">
                {currentProjectObj ? `「${currentProjectObj.name}」还没有作品` : '开启你的第一条镜头创作'}
              </h3>
              <p className="mt-1.5 max-w-md text-center text-[12.5px] leading-relaxed text-mist-400">
                支持文生视频、首帧图生视频、多图融合及高清定妆生图；鼠标悬停卡片即可预览动态画面。
              </p>

              <div className="mt-7 grid w-full max-w-2xl gap-2.5 sm:grid-cols-2">
                {IDEAS.map((idea) => (
                  <button
                    key={idea.tag}
                    onClick={() => setPrompt(idea.text)}
                    className="card card-hover flex flex-col items-start gap-1.5 p-3.5 text-left"
                  >
                    <span className="rounded-md bg-brand-500/12 px-2 py-0.5 font-mono text-[10px] font-medium text-brand-300">
                      {idea.tag}
                    </span>
                    <p className="line-clamp-2 text-[12px] leading-relaxed text-mist-200">{idea.text}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {jobs.map((j) => (
                <JobTile key={j.id} job={j} onClick={() => setPreview(j)} />
              ))}
            </div>
          )}
        </div>

        {/* ---------------- 底部悬浮毛玻璃创作工作台 (DOCK WORKBENCH) ---------------- */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className="shrink-0 border-t border-ink-700/70 glass px-4 pb-4 pt-3 sm:px-6"
        >
          <div className="mx-auto max-w-5xl">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {/* 视频 / 图片 模式切换胶囊 */}
              <div className="flex items-center gap-1 rounded-full border border-ink-700 bg-ink-900/80 p-0.5">
                {[
                  ['video', '视频生成', Film],
                  ['image', '图片生成', ImageIcon],
                ].map(([modeKey, label, Icon]) => (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => setCreateMode(modeKey)}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition',
                      createMode === modeKey
                        ? 'brand-gradient text-white'
                        : 'text-mist-400 hover:text-mist-200',
                    )}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {createMode === 'video' && (
                  <button
                    type="button"
                    onClick={() => setQueueOpen(true)}
                    className="rounded-full border border-brand-500/35 bg-brand-500/10 px-3 py-1 text-[11px] font-medium text-brand-300 transition hover:bg-brand-500/20"
                  >
                    + 定时自动队列
                  </button>
                )}
              </div>
            </div>

            <div
              className={clsx(
                'rounded-2xl border bg-ink-900/90 transition-all',
                dragging
                  ? 'border-brand-400 ring-2 ring-brand-400/25'
                  : 'border-ink-700/90 focus-within:border-brand-500/60',
              )}
            >
              {/* 输入与参考图混排区 */}
              <div className="flex gap-3 p-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title="点击或拖拽上传参考图片（视频模式下第 1 张将作为起始首帧）"
                  className="flex h-[56px] w-[56px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-600 bg-ink-850/80 text-[10px] text-mist-400 transition hover:border-brand-500/50 hover:text-brand-300"
                >
                  {uploading ? <Loader2 size={16} className="animate-spin text-brand-400" /> : <ImagePlus size={16} />}
                  <span>{refs.length ? `${refs.length} 张` : '参考图'}</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => onPick(e.target.files)}
                />

                <div className="min-w-0 flex-1">
                  {refs.length > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {refs.map((r, i) => (
                        <div key={r.url} className="relative h-12 w-12 overflow-hidden rounded-lg border border-ink-600">
                          <img src={r.url} alt="" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setRefs((l) => l.filter((x) => x.url !== r.url))}
                            className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl bg-black/75 text-white"
                          >
                            <X size={9} />
                          </button>
                          <span className="absolute bottom-0 left-0 bg-black/70 px-1 font-mono text-[8.5px] text-brand-300">
                            {i === 0 && createMode === 'video' ? '首帧' : `图${i + 1}`}
                          </span>
                        </div>
                      ))}
                      <span className="text-[10.5px] text-mist-400">
                        {createMode === 'video' ? '第 1 张作为起始画面，人物外观将自动优先遵循参考图' : '已挂载参考图融合'}
                      </span>
                    </div>
                  )}

                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate();
                    }}
                    rows={2}
                    placeholder={
                      dragging
                        ? '松开鼠标即可上传参考图片…'
                        : createMode === 'video'
                          ? '描述人物、场景、光线与动作发展（可拖拽图片到此作为首帧，Ctrl/⌘ + Enter 发送）…'
                          : '描述你想生成的定妆人物或分镜首帧画面（Ctrl/⌘ + Enter 发送）…'
                    }
                    className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-500"
                  />
                </div>
              </div>

              {/* 底部参数控制栏 */}
              <div className="flex flex-wrap items-center gap-2 border-t border-ink-700/70 px-3 py-2">
                {createMode === 'video' ? (
                  <>
                    {/* 真实可用的视频引擎下拉菜单 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setEngineMenuOpen((v) => !v)}
                        className="flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11.5px] text-mist-200 transition hover:border-brand-500/40"
                      >
                        <Film size={12} className="text-brand-400" />
                        <span className="font-mono text-[11px]">{videoModel}</span>
                        <ChevronDown size={11} className="text-mist-400" />
                      </button>
                      {engineMenuOpen && (
                        <div className="card absolute bottom-full left-0 z-30 mb-1.5 min-w-48 p-1 shadow-2xl">
                          {videoEngines.map((eng) => (
                            <button
                              key={eng.id}
                              type="button"
                              onClick={() => { setVideoModel(eng.id); setEngineMenuOpen(false); }}
                              className={clsx(
                                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px]',
                                videoModel === eng.id ? 'bg-brand-500/15 text-brand-300' : 'text-mist-200 hover:bg-ink-750',
                              )}
                            >
                              <span>{eng.name}</span>
                              <span className="font-mono text-[10px] text-mist-400">{eng.id}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
                      {[5, 6, 8, 10].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDuration(d)}
                          className={clsx(
                            'rounded-md px-2 py-1 font-mono text-[11px] transition',
                            duration === d ? 'bg-brand-500/20 font-semibold text-brand-300' : 'text-mist-400 hover:text-mist-200',
                          )}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <select
                      value={imageProvider}
                      onChange={(e) => setImageProvider(e.target.value)}
                      className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-[11.5px] text-mist-200 outline-none"
                    >
                      <option value="muse">Muse Image (账号池)</option>
                      {aiProviders.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {imageProvider !== 'muse' && (
                      <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
                        {['1K', '2K', '4K'].map((res) => (
                          <button
                            key={res}
                            type="button"
                            onClick={() => setResolution(res)}
                            className={clsx(
                              'rounded-md px-2 py-1 font-mono text-[11px] transition',
                              resolution === res ? 'bg-brand-500/20 font-semibold text-brand-300' : 'text-mist-400 hover:text-mist-200',
                            )}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
                  {['16:9', '9:16', '1:1'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSize(s)}
                      className={clsx(
                        'rounded-md px-2 py-1 font-mono text-[11px] transition',
                        size === s ? 'bg-brand-500/20 font-semibold text-brand-300' : 'text-mist-400 hover:text-mist-200',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {createMode === 'video' && (
                  <button
                    type="button"
                    onClick={() => setParamsOpen(true)}
                    className={clsx(
                      'flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] transition',
                      buildExtra(params)
                        ? 'border-brand-500/50 bg-brand-500/12 text-brand-300'
                        : 'border-ink-700 bg-ink-850 text-mist-400 hover:text-mist-200',
                    )}
                  >
                    <Sliders size={11} /> 运镜参数
                    {buildExtra(params) && <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
                  </button>
                )}

                <div className="ml-auto flex items-center gap-3">
                  <span className="hidden font-mono text-[11px] text-mist-400 sm:inline">
                    预计 <strong className="text-mist-200">{cost}</strong> 积分
                    {summary?.usable ? ` · 池在线 ${summary.usable}` : ''}
                  </span>
                  <Button onClick={generate} loading={busy} className="rounded-full px-5">
                    {!busy && <Send size={13} />}
                    {createMode === 'video' ? '生成视频' : '生成图片'}
                  </Button>
                </div>
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

      {/* ---------------- 沉浸式作品检视弹窗 ---------------- */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.type === 'image' ? '图片作品详情' : '视频成片详情'}
        subtitle={preview ? `${fmtAgo(preview.createdAt)} · 消耗 ${preview.cost || 0} 积分` : ''}
        width="max-w-4xl"
      >
        {preview && (
          <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(290px,.8fr)]">
            <div className="flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-ink-700 bg-black/75 lg:min-h-[440px]">
              {preview.mediaUrl ? (
                /\.(mp4|webm|mov)/i.test(preview.mediaUrl) ? (
                  <video
                    src={preview.mediaUrl}
                    poster={preview.posterUrl || undefined}
                    controls
                    autoPlay
                    loop
                    playsInline
                    className="max-h-[70vh] w-full object-contain"
                  />
                ) : (
                  <img src={preview.mediaUrl} alt="" className="max-h-[70vh] w-full object-contain" />
                )
              ) : (
                <div className="grid h-40 place-items-center px-6 text-center text-[12.5px] text-mist-400">
                  {preview.status === 'failed' ? (
                    <span className="text-rose-300">{preview.error}</span>
                  ) : (
                    <span>正在渲染生成中（{preview.progress || 0}%）…</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-col gap-3.5">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={preview.status === 'completed' ? 'ok' : preview.status === 'failed' ? 'error' : 'brand'}>
                  {preview.status === 'completed' ? '已完成' : preview.status === 'failed' ? '生成失败' : `进行中 ${preview.progress || 0}%`}
                </Badge>
                {preview.params?.duration && <Badge>{preview.params.duration}s</Badge>}
                {preview.params?.size && <Badge>{preview.params.size}</Badge>}
                {preview.params?.__refusalRetried && <Badge tone="violet">已自动改词自愈</Badge>}
              </div>

              <div className="rounded-xl border border-ink-700 bg-ink-900/65 p-3.5">
                <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-mist-400">
                  <span>画面提示词</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(preview.prompt || ''); toast('已复制提示词', 'ok'); }}
                    className="text-brand-300 hover:underline"
                  >
                    复制全文
                  </button>
                </div>
                <p className="max-h-[28vh] overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-mist-200">
                  {preview.prompt}
                </p>
              </div>

              {projects.length > 0 && (
                <div>
                  <span className="mb-1 block text-[11.5px] text-mist-400">归档至项目夹</span>
                  <Select
                    value={preview.projectId || ''}
                    onChange={(e) => moveJobToProject(preview.id, e.target.value)}
                  >
                    <option value="">未归档（全部作品库）</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
              )}

              {/* 跨模块创作流转按钮 */}
              {preview.mediaUrl && preview.type === 'image' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      setCreateMode('video');
                      setRefs([{ url: preview.mediaUrl }]);
                      setPrompt(preview.prompt || '');
                      setPreview(null);
                      toast('已将该图挂载为视频首帧参考', 'ok');
                    }}
                  >
                    <Film size={13} /> 以此图生视频
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      localStorage.setItem('rg_director_draft', JSON.stringify({ refUrl: preview.mediaUrl }));
                      nav('/director');
                    }}
                  >
                    <Clapperboard size={13} /> 送入自动导演
                  </Button>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-700/70 pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPrompt(preview.prompt || '');
                    if (preview.params?.size) setSize(preview.params.size);
                    if (preview.params?.duration) setDuration(preview.params.duration);
                    setPreview(null);
                    toast('提示词已填入工作台', 'info');
                  }}
                >
                  复用提示词重做
                </Button>

                <div className="flex gap-2">
                  {preview.mediaUrl && (
                    <a href={preview.mediaUrl} download>
                      <Button size="sm" variant="outline">
                        <Download size={13} /> 下载
                      </Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      if (!window.confirm('删除这条作品？本地媒体文件也会同步清理。')) return;
                      try {
                        await api.deleteJob(preview.id);
                        setJobs((l) => l.filter((x) => x.id !== preview.id));
                        setPreview(null);
                        loadProjects();
                        toast('已删除作品', 'ok');
                      } catch (e) { toast(e.message, 'error'); }
                    }}
                  >
                    <Trash2 size={13} /> 删除
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* --------------------- 首帧海报优先 + 悬停播放卡片 --------------------- */
function JobTile({ job, onClick }) {
  const [hovering, setHovering] = useState(false);
  const running = ['queued', 'processing'].includes(job.status);
  const failed = job.status === 'failed';
  const isVideo = job.type === 'video' || /\.(mp4|webm|mov)/i.test(job.mediaUrl || '');

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="card card-hover group relative flex flex-col overflow-hidden text-left"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink-950">
        {job.mediaUrl ? (
          isVideo ? (
            hovering ? (
              <video
                src={job.mediaUrl}
                poster={job.posterUrl || undefined}
                muted
                autoPlay
                loop
                playsInline
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            ) : job.posterUrl ? (
              <img
                src={job.posterUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <video
                src={`${job.mediaUrl}#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            )
          ) : (
            <img
              src={job.mediaUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          )
        ) : (
          <div className={clsx('grid h-full place-items-center px-3', running && 'shimmer')}>
            {running ? (
              <div className="flex flex-col items-center gap-2 text-[11.5px] font-medium text-brand-300">
                <Loader2 size={18} className="animate-spin" />
                <span>渲染中 {job.progress || 0}%</span>
              </div>
            ) : failed ? (
              <div className="flex flex-col items-center gap-1.5 text-center text-rose-400">
                <AlertTriangle size={18} />
                <span className="line-clamp-2 text-[10.5px] text-rose-300/90">{job.error || '生成失败'}</span>
              </div>
            ) : (
              <ImageIcon size={18} className="text-mist-500" />
            )}
          </div>
        )}

        {/* 左上角规格角标 */}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1">
          <span className="rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-white backdrop-blur-sm">
            {isVideo ? `${job.params?.duration || 5}s` : 'IMG'}
          </span>
          {job.params?.size && (
            <span className="rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[9.5px] text-mist-200 backdrop-blur-sm">
              {job.params.size}
            </span>
          )}
        </div>

        {/* 右上角播放/查看微标 */}
        {job.mediaUrl && (
          <span className="pointer-events-none absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-80 backdrop-blur-sm transition group-hover:bg-brand-500 group-hover:opacity-100">
            {isVideo ? <Play size={10} fill="currentColor" /> : <Eye size={11} />}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between p-3">
        <p className="line-clamp-2 text-[12px] leading-snug text-mist-200 group-hover:text-mist-100">
          {job.prompt}
        </p>
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-mist-400">
          <span>{fmtAgo(job.createdAt)}</span>
          {job.refunded ? (
            <span className="text-amber-400">已退积分</span>
          ) : (
            <span>{job.cost || 0} pts</span>
          )}
        </div>
      </div>
    </button>
  );
}
