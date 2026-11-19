import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Clapperboard, ImagePlus, Layers, Loader2, Play, RefreshCw, RotateCcw, Sparkles, Workflow, X,
  Volume2, Subtitles, Music, Plus, Trash2, ChevronUp, ChevronDown, CheckCircle2, Square, Zap, Link2, Film, Download,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

const ACTIVE = new Set(['planning', 'running', 'assembling']);
const QUEUED = new Set(['queued']);

const STATUS_TEXT = {
  queued: '排队等待',
  planning: '规划分镜',
  running: '生成镜头',
  assembling: '配音字幕合成',
  completed: '成片就绪',
  failed: '异常中止',
};

const PIPELINE_MODES = [
  {
    id: 'keyframe',
    title: '首帧锚定并行',
    tag: '推荐 · 零衰减',
    icon: Sparkles,
    desc: '先并行生成每镜高清首帧定格图，再多账号同步图生视频，速度最快且彻底消除多代接龙糊化。',
  },
  {
    id: 'chain',
    title: '连续续集接龙',
    tag: '一镜顺接',
    icon: Link2,
    desc: '上一段结束帧与运动关键帧传递给下一镜，适合强连贯长镜头（每 3 镜自动断链防五官漂移）。',
  },
  {
    id: 'standard',
    title: '独立镜头直出',
    tag: '轻量快速',
    icon: Film,
    desc: '各镜头依据分镜提示词与角色锚点直接并行生成视频，适合混剪、MV 与空镜蒙太奇。',
  },
];

function statusTone(status) {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'queued') return 'neutral';
  return 'brand';
}

function Section({ step, title, desc, first = false, extra, children }) {
  return (
    <section className={clsx('space-y-3.5', first ? '' : 'border-t border-ink-700/70 pt-5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {step && (
            <span className="rounded-md bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-300">
              {step}
            </span>
          )}
          <h3 className="text-[13.5px] font-semibold text-mist-100">{title}</h3>
          {desc && <span className="text-[11.5px] text-mist-400">{desc}</span>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function Director() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState('single'); // single | batch
  const [form, setForm] = useState({
    direction: '',
    keywords: '',
    totalSeconds: 30,
    shotSeconds: 10,
    size: '9:16',
    style: '真实拍摄质感，自然光',
    characterDescription: '',
    pipelineMode: 'keyframe',
    transition: 'fade',
    voiceoverEnabled: true,
    voiceId: 'xiaoxiao',
    subtitlesEnabled: true,
    bgmUrl: '',
    bgmName: '',
    bgmVolume: 0.22,
    provider: 'chatgpt2api',
    styleId: 'cinematic_film',
    storyId: 'hook_first',
    shotId: 'classic_three',
    characterId: '',
  });
  const [styleGroupTab, setStyleGroupTab] = useState('实拍质感');
  const [batchText, setBatchText] = useState('');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [refPrompt, setRefPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [providers, setProviders] = useState([]);
  const [styles, setStyles] = useState([]);
  const [presets, setPresets] = useState({ stories: [], shots: [], characters: [], voices: [] });
  const fileRef = useRef(null);
  const bgmRef = useRef(null);

  // 可交互编辑的分镜计划
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [current, setCurrent] = useState(null);
  const [list, setList] = useState([]);
  const [batches, setBatches] = useState([]);

  const set = (key) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // 接收来自其他工作台的草稿流转
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem('rg_director_draft') || 'null');
      if (draft) {
        localStorage.removeItem('rg_director_draft');
        setForm((prev) => ({
          ...prev,
          ...(draft.direction ? { direction: draft.direction } : {}),
          ...(draft.size ? { size: draft.size } : {}),
          ...(draft.characterDescription ? { characterDescription: draft.characterDescription } : {}),
        }));
        if (draft.refUrl) setRefs((prev) => [...prev, { url: draft.refUrl }].slice(0, 4));
      }
    } catch { localStorage.removeItem('rg_director_draft'); }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [prod, batch] = await Promise.all([api.productions(), api.productionBatches()]);
      const items = prod.productions || [];
      setList(items);
      setBatches(batch.batches || []);
      const targetId = searchParams.get('id');
      if (targetId) {
        const matched = items.find((i) => i.id === targetId);
        if (matched) setCurrent(matched);
        searchParams.delete('id');
        setSearchParams(searchParams, { replace: true });
        return;
      }
      const active = items.find((item) => ACTIVE.has(item.status) || QUEUED.has(item.status));
      if (active) setCurrent((prev) => (prev && prev.id === active.id ? active : prev || active));
    } catch { /* ignore */ }
  }, [searchParams, setSearchParams]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    api.productionProviders()
      .then((out) => {
        setProviders(out.providers || []);
        if (out.voices?.length) setPresets((p) => ({ ...p, voices: out.voices }));
      })
      .catch(() => setProviders([]));
    api.productionStyles()
      .then((out) => setStyles(out.styles || []))
      .catch(() => setStyles([]));
    api.productionPresets()
      .then((out) => setPresets((prev) => ({
        stories: out.stories || [],
        shots: out.shots || [],
        characters: out.characters || [],
        voices: out.voices || prev.voices || [],
      })))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const anyActive = list.some((item) => ACTIVE.has(item.status) || QUEUED.has(item.status));
    if (!anyActive && !(current && ACTIVE.has(current.status))) return undefined;
    const timer = setInterval(async () => {
      try {
        if (current?.id) {
          const out = await api.production(current.id);
          setCurrent(out.production);
          if (!ACTIVE.has(out.production.status) && !QUEUED.has(out.production.status)
              && (ACTIVE.has(current.status) || QUEUED.has(current.status))) {
            if (out.production.status === 'completed') toast('导演成片已合成完毕！', 'ok');
            if (out.production.status === 'failed') toast(out.production.error || '生产中止', 'error');
          }
        }
        await loadAll();
      } catch { /* ignore */ }
    }, 3500);
    return () => clearInterval(timer);
  }, [current, list, loadAll, toast]);

  const activeStyle = styles.find((item) => item.id === form.styleId) || null;
  const activeStory = presets.stories.find((item) => item.id === form.storyId) || null;
  const activeShot = presets.shots.find((item) => item.id === form.shotId) || null;
  const activeCard = presets.characters.find((item) => item.id === form.characterId) || null;

  const groupedStyles = useMemo(() => {
    const map = new Map();
    for (const item of styles) {
      const key = item.group || '其他';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [styles]);

  const onPickRefs = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 4) return toast('人物参考图最多 4 张', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((prev) => [...prev, ...(out.files || [])].slice(0, 4));
      toast('身份锚点照片已上传', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPickBgm = async (file) => {
    if (!file) return;
    setBgmUploading(true);
    try {
      const out = await api.upload([file]);
      const item = out.files?.[0];
      if (!item?.url) throw new Error('音频上传失败');
      setForm((prev) => ({ ...prev, bgmUrl: item.url, bgmName: item.name || '自定义配乐' }));
      toast('背景配乐已挂载（人声响起时将自动闪避压低音量）', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBgmUploading(false);
      if (bgmRef.current) bgmRef.current.value = '';
    }
  };

  const generateRef = async () => {
    if (refPrompt.trim().length < 4) return toast('请先描述人物外貌特征', 'error');
    if (refs.length >= 4) return toast('参考图最多 4 张', 'error');
    setGenerating(true);
    try {
      const out = await api.generateReferenceImage({ prompt: refPrompt.trim(), provider: form.provider });
      setRefs((prev) => [...prev, { url: out.image.url }].slice(0, 4));
      setRefPrompt('');
      toast(`角色定妆参考图已生成（消耗 ${out.image.cost || 0} 积分）`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const pickCard = (event) => {
    const characterId = event.target.value;
    const card = presets.characters.find((item) => item.id === characterId);
    const summary = card
      ? [card.age, card.gender, card.temperament, card.hair, card.outfit, card.accessory].join('，')
      : '';
    setForm((prev) => ({ ...prev, characterId, characterDescription: summary || prev.characterDescription }));
  };

  const selectStylePreset = (preset) => {
    if (!preset) {
      setForm((prev) => ({ ...prev, styleId: '' }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      styleId: preset.id,
      ...(preset.aspect ? { size: preset.aspect } : {}),
    }));
  };

  /* ---------- 分镜规划与交互式编辑 ---------- */
  const draftPlan = async () => {
    if (form.direction.trim().length < 2) return toast('请先填写创作方向', 'error');
    setPlanning(true);
    try {
      const out = await api.planProduction({ ...form, characterRefs: refs.map((r) => r.url) });
      setPlan(out.plan);
      toast(`已生成 ${out.plan.shots.length} 镜可编辑脚本，确认或微调后可直接锁定投产`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPlanning(false);
    }
  };

  const updateShot = (idx, patch) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = prev.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...prev, shots };
    });
  };

  const moveShot = (idx, dir) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.shots.length) return prev;
      const shots = [...prev.shots];
      [shots[idx], shots[target]] = [shots[target], shots[idx]];
      return { ...prev, shots: shots.map((s, i) => ({ ...s, index: i + 1 })) };
    });
  };

  const addShot = () => {
    setPlan((prev) => {
      if (!prev || prev.shots.length >= 8) {
        toast('单支短片最多支持 8 个分镜', 'info');
        return prev;
      }
      const nextIdx = prev.shots.length + 1;
      return {
        ...prev,
        shots: [
          ...prev.shots,
          {
            index: nextIdx,
            label: `镜头 ${nextIdx}`,
            duration: Number(form.shotSeconds) || 10,
            continuation: form.pipelineMode === 'chain',
            keyframePrompt: '',
            narration: '',
            prompt: '补充本镜头的景别、人物动作、场景与光线发展…',
          },
        ],
      };
    });
  };

  const removeShot = (idx) => {
    setPlan((prev) => {
      if (!prev || prev.shots.length <= 1) return prev;
      const shots = prev.shots.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i + 1 }));
      return { ...prev, shots };
    });
  };

  /* ---------- 启动生产（若有 plan 则原样锁定投产！） ---------- */
  const start = async (useConfirmedPlan = true) => {
    if (form.direction.trim().length < 2) return toast('请先填写创作方向', 'error');
    setStarting(true);
    try {
      const payload = {
        ...form,
        characterRefs: refs.map((item) => item.url),
        ...(useConfirmedPlan && plan ? { plan } : {}),
      };
      const out = await api.createProduction(payload);
      setCurrent(out.production);
      setPlan(null);
      await loadAll();
      toast(useConfirmedPlan && plan ? '已按您确认的分镜脚本锁定投产！' : '已启动全自动规划与生产！', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const startBatch = async () => {
    const lines = batchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return toast('请至少填写一条创作方向', 'error');
    if (lines.length > 20) return toast('单次最多批量提交 20 条', 'error');
    setStarting(true);
    try {
      const out = await api.createProductionBatch({
        ...form, directions: batchText, characterRefs: refs.map((item) => item.url),
      });
      toast(`已入队 ${out.batch.count} 支短片，后台将按顺序串行出片`, 'ok');
      setBatchText('');
      await loadAll();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm('确定中止当前正在运行的生产任务？未完成镜头的积分会自动退还。')) return;
    try {
      const out = await api.cancelProduction(id);
      setCurrent(out.production);
      await loadAll();
      toast('任务已取消，积分已退回', 'info');
    } catch (e) { toast(e.message, 'error'); }
  };

  const handleRetry = async (id, failedOnly = false) => {
    try {
      const out = await api.retryProduction(id, { failedOnly });
      setCurrent(out.production);
      await loadAll();
      toast(failedOnly ? '正在仅重跑失败镜头，成功镜头已保留' : '已重新加入生产队列', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const shotTotal = useMemo(
    () => (plan ? plan.shots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0) : 0),
    [plan],
  );

  const voices = presets.voices?.length ? presets.voices : [
    { id: 'xiaoxiao', label: '晓晓 · 温暖叙事女声' },
    { id: 'yunxi', label: '云希 · 清朗青年男声' },
    { id: 'yunjian', label: '云健 · 沉稳电影旁白' },
    { id: 'xiaoyi', label: '晓伊 · 灵动口播少女' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1360px] px-5 py-6 lg:px-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Auto Director v3 · End-to-End Cinema Pipeline</p>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[27px] font-semibold tracking-tight text-mist-100">
            自动导演工作台
            <span className="brand-text">一句话进，配音字幕成片出</span>
          </h1>
          <p className="mt-1 text-[13px] text-mist-400">
            AI 编写分镜脚本与旁白 → 支持在线逐镜微调 → 首帧锚定多账号并行渲染 → 自动质检修复 → 配音、字幕与 BGM 混音合成。
          </p>
        </div>

        <div className="flex rounded-2xl border border-ink-700 bg-ink-850/90 p-1">
          {[
            ['single', '单支精拍（支持审阅改分镜）'],
            ['batch', '矩阵批量（最高 20 条串行）'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={clsx(
                'rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition',
                mode === key ? 'bg-ink-750 text-mist-100 shadow-sm' : 'text-mist-400 hover:text-mist-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ================ 左侧：导演创作设定面板 ================ */}
        <div className="card space-y-6 p-5 sm:p-6">
          <Section step="01" title="创意方向与成片规格" desc="决定拍什么主题、多长篇幅" first>
            {mode === 'single' ? (
              <div className="space-y-3">
                <Field label="故事主题 / 创作方向">
                  <Textarea
                    rows={2}
                    value={form.direction}
                    onChange={set('direction')}
                    placeholder="例如：都市独立女设计师周末去山野木屋独处充电，从疲惫通勤到治愈放松的短片"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="核心意象关键词" hint="用逗号分隔，会融入镜头细节">
                    <Input value={form.keywords} onChange={set('keywords')} placeholder="清晨薄雾, 手冲咖啡, 木窗雨滴, 暖黄台灯" />
                  </Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="总时长">
                      <Select value={form.totalSeconds} onChange={set('totalSeconds')}>
                        {[15, 20, 30, 40, 50, 60].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                      </Select>
                    </Field>
                    <Field label="单镜时长">
                      <Select value={form.shotSeconds} onChange={set('shotSeconds')}>
                        {[5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                      </Select>
                    </Field>
                    <Field label="画幅">
                      <Select value={form.size} onChange={set('size')}>
                        {['9:16', '16:9', '1:1'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    </Field>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Field
                  label="批量创作方向清单"
                  hint="每行代表一支独立短片，格式支持「创作方向|关键词1,关键词2」；共享下方所有风格、角色与配音配置"
                >
                  <Textarea
                    rows={6}
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    className="font-mono text-[12px]"
                    placeholder={'都市女性周末山野独处|清晨薄雾,手冲咖啡,木屋\n海边黄昏慢跑释放压力|落日逆光,海浪,慢动作\n深夜书房复盘写作|暖光台灯,钢笔特写,窗外夜雨'}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="每支总时长">
                    <Select value={form.totalSeconds} onChange={set('totalSeconds')}>
                      {[15, 20, 30, 40, 50, 60].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                    </Select>
                  </Field>
                  <Field label="单镜时长">
                    <Select value={form.shotSeconds} onChange={set('shotSeconds')}>
                      {[5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                    </Select>
                  </Field>
                  <Field label="画幅">
                    <Select value={form.size} onChange={set('size')}>
                      {['9:16', '16:9', '1:1'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Field>
                </div>
              </div>
            )}
          </Section>

          <Section step="02" title="渲染管线架构" desc="如何在速度、连贯性与画质之间取得最佳平衡">
            <div className="grid gap-3 md:grid-cols-3">
              {PIPELINE_MODES.map((pm) => {
                const selected = form.pipelineMode === pm.id;
                return (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, pipelineMode: pm.id }))}
                    className={clsx(
                      'flex flex-col items-start rounded-2xl border p-3.5 text-left transition',
                      selected
                        ? 'border-brand-400/70 bg-brand-500/10 shadow-md'
                        : 'border-ink-700 bg-ink-900/50 hover:border-ink-500',
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-mist-100">
                        <pm.icon size={14} className={selected ? 'text-brand-300' : 'text-mist-400'} />
                        {pm.title}
                      </span>
                      <span className={clsx(
                        'rounded-full px-2 py-0.5 font-mono text-[9.5px]',
                        selected ? 'bg-brand-500/25 text-brand-300' : 'bg-ink-800 text-mist-400',
                      )}>
                        {pm.tag}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-mist-400">{pm.desc}</p>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section step="03" title="摄影光学风格与叙事节奏" desc="7 维摄影机参数约束 + 剧作节拍映射">
            {/* 风格分类胶囊 + 卡片矩阵 */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {groupedStyles.map(([group]) => (
                  <button
                    key={group}
                    type="button"
                    onClick={() => setStyleGroupTab(group)}
                    className={clsx(
                      'rounded-full px-3 py-1 text-[11.5px] font-medium transition',
                      styleGroupTab === group && form.styleId !== ''
                        ? 'bg-ink-700 text-mist-100'
                        : 'text-mist-400 hover:bg-ink-800 hover:text-mist-200',
                    )}
                  >
                    {group}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => selectStylePreset(null)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-[11.5px] font-medium transition',
                    form.styleId === '' ? 'bg-brand-500/20 text-brand-300' : 'text-mist-400 hover:text-mist-200',
                  )}
                >
                  自定义风格
                </button>
              </div>

              {form.styleId === '' ? (
                <Field label="自定义摄影风格描述">
                  <Input
                    value={form.style}
                    onChange={set('style')}
                    placeholder="例如：阴天柔和散射光，85mm长焦浅景深，低饱和胶片冷调，平稳滑轨推镜"
                  />
                </Field>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(groupedStyles.find(([g]) => g === styleGroupTab)?.[1] || []).map((preset) => {
                      const active = form.styleId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => selectStylePreset(preset)}
                          className={clsx(
                            'rounded-xl border p-2.5 text-left transition',
                            active
                              ? 'border-brand-400/75 bg-brand-500/12'
                              : 'border-ink-700/90 bg-ink-900/55 hover:border-ink-500',
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[12px] font-semibold text-mist-100">{preset.label}</span>
                            <span className="font-mono text-[9.5px] text-mist-400">{preset.aspect}</span>
                          </div>
                          <p className="mt-1 line-clamp-1 text-[10.5px] text-mist-400">{preset.note}</p>
                        </button>
                      );
                    })}
                  </div>

                  {activeStyle && (
                    <div className="grid gap-2 rounded-xl border border-ink-700/80 bg-ink-900/55 px-3.5 py-2.5 text-[11px] sm:grid-cols-2">
                      <div><span className="text-mist-500">机身镜头：</span><span className="text-mist-300">{activeStyle.camera}</span></div>
                      <div><span className="text-mist-500">布光方案：</span><span className="text-mist-300">{activeStyle.lighting}</span></div>
                      <div><span className="text-mist-500">色彩科学：</span><span className="text-mist-300">{activeStyle.color}</span></div>
                      <div><span className="text-mist-500">运镜构图：</span><span className="text-mist-300">{activeStyle.composition}</span></div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <Field label="剧作叙事结构" hint={activeStory?.note || '自动将镜头分配到起承转合节拍'}>
                <Select value={form.storyId} onChange={set('storyId')}>
                  <option value="">自由叙事</option>
                  {presets.stories.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </Select>
                {activeStory && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {activeStory.beats.map((beat, idx) => (
                      <Fragment key={beat.label}>
                        <span className="rounded-md border border-ink-700 bg-ink-850 px-2 py-0.5 text-[10.5px] text-mist-200">
                          {beat.label} <span className="font-mono text-mist-400">{Math.round(beat.weight * 100)}%</span>
                        </span>
                        {idx < activeStory.beats.length - 1 && <span className="text-mist-500">→</span>}
                      </Fragment>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="镜头调度配方" hint={activeShot?.note || '控制全片远中近景别过渡'}>
                <Select value={form.shotId} onChange={set('shotId')}>
                  <option value="">自动匹配</option>
                  {presets.shots.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </Select>
                {activeShot && (
                  <p className="mt-2 rounded-lg border border-ink-700/70 bg-ink-900/50 px-2.5 py-1.5 text-[10.5px] text-mist-300">
                    开场：{activeShot.grammar.open} · 中段：{activeShot.grammar.middle} · 收尾：{activeShot.grammar.close}
                  </p>
                )}
              </Field>
            </div>
          </Section>

          <Section step="04" title="主角设定与身份锁定锚点" desc="多镜五官与造型一致性保障">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="人物原型卡">
                <Select value={form.characterId} onChange={pickCard}>
                  <option value="">自定义或不指定固定主角</option>
                  {presets.characters.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}（{item.note}）</option>
                  ))}
                </Select>
              </Field>
              <Field label="人物外观描述" hint={refs.length ? '已挂载参考图，系统会自动以参考图造型为准避免冲突' : '会逐镜复述以稳定特征'}>
                <Input
                  value={form.characterDescription}
                  onChange={set('characterDescription')}
                  placeholder={activeCard ? activeCard.outfit : '例如：26岁女性，黑齐肩短发，米白针织衫'}
                />
              </Field>
            </div>

            <Field label="角色定妆参考照片（最多 4 张，锁定全片同一张脸）">
              <div className="flex flex-wrap items-center gap-2.5">
                {refs.map((ref, index) => (
                  <div key={ref.url} className="relative h-16 w-16 overflow-hidden rounded-xl border border-brand-500/40">
                    <img src={ref.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setRefs((prev) => prev.filter((item) => item.url !== ref.url))}
                      className="absolute right-0 top-0 grid h-4 w-4 place-items-center bg-black/75 text-white"
                    >
                      <X size={9} />
                    </button>
                    <span className="absolute bottom-0 left-0 bg-black/70 px-1 font-mono text-[8.5px] text-brand-300">
                      锚点#{index + 1}
                    </span>
                  </div>
                ))}
                {refs.length < 4 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-600 text-[10px] text-mist-400 transition hover:border-brand-500/50 hover:text-brand-300"
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    上传照片
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPickRefs(e.target.files)} />

                <div className="flex min-w-[240px] flex-1 items-center gap-2">
                  <Input
                    value={refPrompt}
                    onChange={(e) => setRefPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') generateRef(); }}
                    placeholder="没有现成照片？输入人物长相一键 AI 生成定妆照（5 积分）"
                    className="h-9 text-[12px]"
                  />
                  <Button variant="outline" size="sm" onClick={generateRef} loading={generating} className="h-9">
                    <Sparkles size={12} /> AI 定妆
                  </Button>
                </div>
              </div>
            </Field>
          </Section>

          <Section step="05" title="配音旁白、字幕烧录与后期混音" desc="让成片直接具备短视频平台发布质感">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-ink-700 bg-ink-900/55 p-3.5">
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-mist-100">
                    <Volume2 size={15} className="text-brand-400" />
                    AI 神经网络旁白配音 (TTS)
                  </span>
                  <input
                    type="checkbox"
                    checked={form.voiceoverEnabled}
                    onChange={(e) => setForm((p) => ({
                      ...p,
                      voiceoverEnabled: e.target.checked,
                      ...(e.target.checked ? { subtitlesEnabled: true } : {}),
                    }))}
                    className="accent-brand-400"
                  />
                </label>
                {form.voiceoverEnabled && (
                  <div className="mt-2.5">
                    <Select value={form.voiceId} onChange={set('voiceId')} className="py-1.5 text-[12px]">
                      {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </Select>
                  </div>
                )}
                <p className="mt-2 text-[10.5px] text-mist-400">
                  自动按分镜台词合成高自然度中文配音，并智能压低原片环境杂音。
                </p>
              </div>

              <div className="space-y-2.5 rounded-xl border border-ink-700 bg-ink-900/55 p-3.5">
                <label className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-mist-100">
                    <Subtitles size={15} className="text-sky-400" />
                    自动烧录电影感字幕
                  </span>
                  <input
                    type="checkbox"
                    checked={form.subtitlesEnabled}
                    onChange={set('subtitlesEnabled')}
                    className="accent-brand-400"
                  />
                </label>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => bgmRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-600 px-2.5 py-1.5 text-[11px] text-mist-300 hover:border-brand-500/50 hover:text-brand-300"
                  >
                    {bgmUploading ? <Loader2 size={12} className="animate-spin" /> : <Music size={12} />}
                    {form.bgmUrl ? `配乐：${form.bgmName || '已上传'}` : '上传 BGM 配乐（自动人声闪避）'}
                  </button>
                  {form.bgmUrl && (
                    <button
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, bgmUrl: '', bgmName: '' }))}
                      className="text-[11px] text-rose-300 hover:underline"
                    >
                      移除
                    </button>
                  )}
                  <input ref={bgmRef} type="file" accept="audio/*" hidden onChange={(e) => onPickBgm(e.target.files?.[0])} />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="策划与修复 AI 引擎">
                <Select value={form.provider} onChange={set('provider')}>
                  {(providers.length ? providers : [{ id: 'chatgpt2api', label: 'ChatGPT2API' }]).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}{item.textModel ? ` · ${item.textModel}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="镜头间转场方式">
                <Select value={form.transition} onChange={set('transition')}>
                  <option value="fade">柔和叠化转场（0.35s 电影感过渡）</option>
                  <option value="cut">干脆硬切（快节奏信息流）</option>
                </Select>
              </Field>
            </div>
          </Section>

          {/* 底部提交行动栏 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700/80 pt-4">
            {mode === 'single' ? (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button variant="outline" size="lg" onClick={draftPlan} loading={planning}>
                    <Sparkles size={15} /> {plan ? '重新 AI 规划分镜' : '1. 先规划并编辑分镜'}
                  </Button>
                  <Button size="lg" onClick={() => start(true)} loading={starting}>
                    <Play size={15} /> {plan ? `2. 按右侧 ${plan.shots.length} 镜脚本锁定投产` : '一键全自动出片'}
                  </Button>
                </div>
                <span className="font-mono text-[11.5px] text-mist-400">
                  预计 {plan ? `${plan.shots.length} 镜 · ${shotTotal}s` : `${Math.max(1, Math.round(form.totalSeconds / form.shotSeconds))} 镜 · ${form.totalSeconds}s`}
                </span>
              </>
            ) : (
              <>
                <Button size="lg" onClick={startBatch} loading={starting}>
                  <Layers size={15} /> 提交批量串行生产队列
                </Button>
                <span className="font-mono text-[11.5px] text-mist-400">
                  待提交 {batchText.split(/\r?\n/).filter((line) => line.trim()).length} 支短片
                </span>
              </>
            )}
          </div>
        </div>

        {/* ================ 右侧：可编辑分镜台 + 实时生产监视器 ================ */}
        <aside className="space-y-5">
          {/* 1. 交互式分镜脚本编辑器 */}
          {plan && mode === 'single' && (
            <section className="card glow-frame p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <span className="eyebrow">Editable Storyboard</span>
                  <input
                    value={plan.title || ''}
                    onChange={(e) => setPlan((p) => ({ ...p, title: e.target.value }))}
                    className="mt-0.5 block w-full bg-transparent text-[15px] font-semibold text-mist-100 outline-none focus:text-brand-300"
                    placeholder="短片标题"
                  />
                </div>
                <Badge tone="brand">{plan.shots.length} 镜 · {shotTotal}s</Badge>
              </div>

              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {plan.shots.map((shot, idx) => (
                  <div key={idx} className="rounded-xl border border-ink-700 bg-ink-900/80 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={shot.label}
                        onChange={(e) => updateShot(idx, { label: e.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-brand-300 outline-none"
                      />
                      <div className="flex items-center gap-1">
                        <select
                          value={shot.duration}
                          onChange={(e) => updateShot(idx, { duration: Number(e.target.value) })}
                          className="rounded border border-ink-600 bg-ink-850 px-1.5 py-0.5 font-mono text-[10.5px] text-mist-200"
                        >
                          {[5, 6, 8, 10].map((d) => <option key={d} value={d}>{d}s</option>)}
                        </select>
                        <button type="button" onClick={() => moveShot(idx, -1)} disabled={idx === 0} className="rounded p-1 text-mist-400 hover:bg-ink-750 disabled:opacity-25"><ChevronUp size={12} /></button>
                        <button type="button" onClick={() => moveShot(idx, 1)} disabled={idx === plan.shots.length - 1} className="rounded p-1 text-mist-400 hover:bg-ink-750 disabled:opacity-25"><ChevronDown size={12} /></button>
                        {plan.shots.length > 1 && (
                          <button type="button" onClick={() => removeShot(idx)} className="rounded p-1 text-mist-400 hover:text-rose-400"><Trash2 size={12} /></button>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] text-mist-400">视频动作与镜头提示词</span>
                      <textarea
                        rows={3}
                        value={shot.prompt}
                        onChange={(e) => updateShot(idx, { prompt: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-mist-200 outline-none focus:border-brand-500/60"
                      />
                    </div>

                    {(form.voiceoverEnabled || form.subtitlesEnabled) && (
                      <div>
                        <span className="text-[10px] text-sky-400">本镜旁白台词 / 烧录字幕</span>
                        <input
                          value={shot.narration || ''}
                          onChange={(e) => updateShot(idx, { narration: e.target.value })}
                          placeholder="留空则本镜仅保留环境音无字幕…"
                          className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 text-[11.5px] text-mist-100 outline-none focus:border-sky-400/60"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-700/70 pt-3">
                <Button size="xs" variant="ghost" onClick={addShot}>
                  <Plus size={12} /> 新增分镜
                </Button>
                <Button size="sm" onClick={() => start(true)} loading={starting}>
                  <Play size={13} /> 确认无误，立即投产
                </Button>
              </div>
            </section>
          )}

          {/* 2. 当前生产任务实时监视器 */}
          {current && (
            <section className="card p-4 sm:p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="eyebrow">Live Monitor</span>
                  <h2 className="mt-0.5 truncate text-[15px] font-semibold text-mist-100">
                    {current.plan?.title || current.brief?.direction || '未命名短片'}
                  </h2>
                </div>
                <Badge tone={statusTone(current.status)}>
                  {STATUS_TEXT[current.status] || current.status}
                </Badge>
              </div>

              {/* 4 阶段步进进度条 */}
              <StageStepper status={current.status} stage={current.stage} />

              {/* 逐镜实时进度与首帧/成片缩略图 */}
              {current.shotStates?.length > 0 && (
                <div className="mt-3.5 space-y-2">
                  <p className="text-[11px] font-medium text-mist-300">分镜实时渲染状态</p>
                  <div className="max-h-[250px] space-y-1.5 overflow-y-auto pr-1">
                    {current.shotStates.map((st) => (
                      <div key={st.nodeId} className="flex items-center gap-2.5 rounded-xl border border-ink-700/80 bg-ink-900/65 p-2">
                        <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-950">
                          {st.mediaUrl ? (
                            <video src={`${st.mediaUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />
                          ) : st.keyframeUrl ? (
                            <img src={st.keyframeUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full place-items-center text-[10px] text-mist-500">#{st.index}</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1 text-[11.5px]">
                            <span className="truncate font-medium text-mist-200">{st.label}</span>
                            <span className={clsx(
                              'shrink-0 font-mono text-[10px]',
                              st.status === 'completed' ? 'text-emerald-300' : st.status === 'failed' ? 'text-rose-300' : 'text-brand-300',
                            )}>
                              {st.status === 'completed'
                                ? (st.qualityScore != null ? `${st.qualityScore}分` : '完成')
                                : st.status === 'failed'
                                  ? '失败'
                                  : st.keyframeStatus && st.keyframeStatus !== 'completed'
                                    ? '绘首帧'
                                    : `${st.progress || 0}%`}
                            </span>
                          </div>
                          {st.narration && <p className="truncate text-[10px] text-mist-400">“{st.narration}”</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 最终成片播放器 */}
              {current.output?.url && (
                <div className="mt-4 space-y-2.5">
                  <div className="overflow-hidden rounded-2xl border border-ink-700 bg-black shadow-xl">
                    <video src={current.output.url} controls className="max-h-[420px] w-full" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-mist-400">
                    <span>
                      {current.output.totalSeconds || '—'}s · {current.output.shotCount || 0} 镜
                      {current.output.voicedCount ? ` · 配音 ${current.output.voicedCount} 句` : ''}
                      {current.output.subtitled ? ' · 已压字幕' : ''}
                      {current.output.quality?.checked ? ` · 质检 ${current.output.quality.passed}/${current.output.quality.checked}` : ''}
                    </span>
                    <a href={current.output.url} download>
                      <Button size="xs" variant="outline"><Download size={11} /> 下载 MP4</Button>
                    </a>
                  </div>
                </div>
              )}

              {current.error && (
                <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-rose-300">
                  {current.error}
                </div>
              )}

              {/* 操作栏：跳转画布 / 取消 / 仅重跑失败镜头 */}
              <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-ink-700/70 pt-3">
                {current.canvasId && (
                  <Link to={`/canvas?canvas=${current.canvasId}`}>
                    <Button size="xs" variant="outline">
                      <Workflow size={12} /> 在画布中精修剪辑
                    </Button>
                  </Link>
                )}
                {(ACTIVE.has(current.status) || QUEUED.has(current.status)) && (
                  <Button size="xs" variant="danger" onClick={() => handleCancel(current.id)}>
                    <Square size={11} /> 取消任务
                  </Button>
                )}
                {current.status === 'failed' && current.canvasId && (
                  <Button size="xs" onClick={() => handleRetry(current.id, true)}>
                    <Zap size={11} /> 仅重跑失败镜头
                  </Button>
                )}
                {current.status === 'failed' && (
                  <Button size="xs" variant="soft" onClick={() => handleRetry(current.id, false)}>
                    <RotateCcw size={11} /> 整片重新排队
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* 3. 批量队列面板 */}
          {batches.length > 0 && (
            <section className="card p-4">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold text-mist-100">批量生产批次</h2>
                <button onClick={loadAll} className="text-mist-400 hover:text-brand-300"><RefreshCw size={12} /></button>
              </div>
              <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                {batches.map((batch) => (
                  <div key={batch.batchId} className="rounded-xl border border-ink-700 bg-ink-900/70 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                      <span className="font-medium text-mist-200">批次 · {batch.total} 支短片</span>
                      <span className="font-mono text-[10.5px] text-brand-300">
                        完成 {batch.done}/{batch.total}{batch.failed ? ` · 失败 ${batch.failed}` : ''}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {batch.productions.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setCurrent(item)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-mist-300 transition hover:bg-ink-800"
                        >
                          <span className="truncate">{item.plan?.title || item.brief?.direction || '未命名'}</span>
                          <span className={clsx(
                            'shrink-0 text-[10px]',
                            item.status === 'failed' ? 'text-rose-300' : item.status === 'completed' ? 'text-emerald-300' : 'text-brand-300',
                          )}>
                            {STATUS_TEXT[item.status] || item.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. 历史成片片库 */}
          <section className="card p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-mist-100">导演成片历史</h2>
              <span className="font-mono text-[10.5px] text-mist-400">{list.length} 部</span>
            </div>
            {list.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-mist-400">尚未生产过成片，填写左侧方向即可开拍</p>
            ) : (
              <div className="max-h-[260px] space-y-1 overflow-y-auto pr-1">
                {list.slice(0, 24).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setCurrent(item)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] transition',
                      current?.id === item.id ? 'bg-ink-750 font-medium text-mist-100' : 'text-mist-300 hover:bg-ink-800/70',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {item.status === 'completed' ? (
                        <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                      ) : ACTIVE.has(item.status) ? (
                        <Loader2 size={13} className="shrink-0 animate-spin text-brand-400" />
                      ) : (
                        <Clapperboard size={13} className="shrink-0 text-mist-400" />
                      )}
                      <span className="truncate">{item.plan?.title || item.brief?.direction || '未命名'}</span>
                    </span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] text-mist-400">{fmtAgo(item.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function StageStepper({ status, stage }) {
  const steps = ['规划脚本', '生成画面', '配音字幕合成', '成片就绪'];
  const currentIdx = status === 'planning' || status === 'queued'
    ? 0
    : status === 'running'
      ? 1
      : status === 'assembling'
        ? 2
        : status === 'completed'
          ? 3
          : -1;

  return (
    <div className="rounded-xl border border-ink-700/80 bg-ink-900/60 p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((label, idx) => {
          const done = currentIdx > idx || status === 'completed';
          const active = currentIdx === idx && status !== 'completed' && status !== 'failed';
          return (
            <div key={label} className="space-y-1">
              <div className={clsx(
                'h-1.5 rounded-full transition-all',
                done ? 'bg-emerald-400' : active ? 'bg-brand-400 animate-pulse' : status === 'failed' && idx === 1 ? 'bg-rose-500' : 'bg-ink-700',
              )} />
              <p className={clsx('text-[10px]', active ? 'font-semibold text-brand-300' : done ? 'text-mist-200' : 'text-mist-500')}>
                {label}
              </p>
            </div>
          );
        })}
      </div>
      {stage && <p className="mt-2 text-[11px] text-mist-300">当前状态：{stage}</p>}
    </div>
  );
}
