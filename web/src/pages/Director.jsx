import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clapperboard, ImagePlus, Layers, Loader2, Play, RefreshCw, RotateCcw, Sparkles, Workflow, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

const ACTIVE = new Set(['planning', 'running', 'assembling']);
const QUEUED = new Set(['queued']);

const STATUS_TEXT = {
  queued: '排队中',
  planning: '规划分镜',
  running: '生成中',
  assembling: '合成成片',
  completed: '已完成',
  failed: '失败',
};

function statusTone(status) {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-300';
  if (status === 'failed') return 'bg-rose-500/15 text-rose-300';
  if (status === 'queued') return 'bg-ink-700 text-mist-300';
  return 'bg-brand-500/15 text-brand-300';
}

export default function Director() {
  const toast = useToast();
  const [mode, setMode] = useState('single');
  const [form, setForm] = useState({
    direction: '',
    keywords: '',
    totalSeconds: 30,
    shotSeconds: 10,
    size: '9:16',
    style: '真实拍摄质感，自然光',
    characterDescription: '',
    chain: false,
    provider: 'chatgpt2api',
    styleId: 'ugc_phone',
  });
  const [batchText, setBatchText] = useState('');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [refPrompt, setRefPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [providers, setProviders] = useState([]);
  const [styles, setStyles] = useState([]);
  const fileRef = useRef(null);
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

  const loadAll = useCallback(async () => {
    try {
      const [prod, batch] = await Promise.all([api.productions(), api.productionBatches()]);
      setList(prod.productions || []);
      setBatches(batch.batches || []);
      const active = (prod.productions || []).find((item) => ACTIVE.has(item.status) || QUEUED.has(item.status));
      if (active) setCurrent((prev) => (prev && prev.id === active.id ? prev : active));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    api.productionProviders()
      .then((out) => setProviders(out.providers || []))
      .catch(() => setProviders([]));
    api.productionStyles()
      .then((out) => setStyles(out.styles || []))
      .catch(() => setStyles([]));
  }, []);

  const currentSettled = current && !ACTIVE.has(current.status);

  // 有进行中/排队中的任务就轮询
  useEffect(() => {
    const anyActive = list.some((item) => ACTIVE.has(item.status) || QUEUED.has(item.status));
    if (!anyActive && !(current && ACTIVE.has(current.status))) return undefined;
    const timer = setInterval(async () => {
      try {
        if (current?.id) {
          const out = await api.production(current.id);
          setCurrent(out.production);
          if (!ACTIVE.has(out.production.status) && !QUEUED.has(out.production.status)) {
            if (out.production.status === 'completed') toast('成片已生成', 'ok');
            if (out.production.status === 'failed') toast(out.production.error || '生产失败', 'error');
          }
        }
        await loadAll();
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(timer);
  }, [current, list, loadAll, toast]);

  const onPick = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 4) return toast('参考图最多 4 张', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((prev) => [...prev, ...(out.files || [])].slice(0, 4));
      toast('参考图已上传', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pickStyle = (event) => {
    const styleId = event.target.value;
    const preset = styles.find((item) => item.id === styleId);
    setForm((prev) => ({
      ...prev,
      styleId,
      ...(preset?.aspect ? { size: preset.aspect } : {}),
    }));
  };

  const activeStyle = styles.find((item) => item.id === form.styleId) || null;
  const groupedStyles = useMemo(() => {
    const map = new Map();
    for (const item of styles) {
      const key = item.group || '其他';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map.entries()];
  }, [styles]);

  const generateRef = async () => {
    if (refPrompt.trim().length < 4) return toast('请先描述人物长相', 'error');
    if (refs.length >= 4) return toast('参考图最多 4 张', 'error');
    setGenerating(true);
    try {
      const out = await api.generateReferenceImage({ prompt: refPrompt.trim(), provider: form.provider });
      setRefs((prev) => [...prev, { url: out.image.url }].slice(0, 4));
      setRefPrompt('');
      toast(`参考图已生成（${out.image.cost || 0} 积分）`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const draftPlan = async () => {
    if (form.direction.trim().length < 2) return toast('请先填写创作方向', 'error');
    setPlanning(true);
    try {
      const out = await api.planProduction(form);
      setPlan(out.plan);
      toast(`已规划 ${out.plan.shots.length} 个镜头，约 ${out.plan.totalSeconds} 秒`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setPlanning(false);
    }
  };

  const start = async () => {
    if (form.direction.trim().length < 2) return toast('请先填写创作方向', 'error');
    setStarting(true);
    try {
      const out = await api.createProduction({ ...form, characterRefs: refs.map((item) => item.url) });
      setCurrent(out.production);
      setPlan(null);
      await loadAll();
      toast('已提交生产，可离开页面', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const startBatch = async () => {
    const lines = batchText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return toast('请至少填写一条方向', 'error');
    if (lines.length > 20) return toast('单次最多 20 条', 'error');
    setStarting(true);
    try {
      const out = await api.createProductionBatch({
        ...form, directions: batchText, characterRefs: refs.map((item) => item.url),
      });
      toast(`已提交 ${out.batch.count} 条，串行执行`, 'ok');
      setBatchText('');
      await loadAll();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const retry = async (id) => {
    try {
      await api.retryProduction(id);
      toast('已重新排队', 'ok');
      await loadAll();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  const shotTotal = useMemo(
    () => (plan ? plan.shots.reduce((sum, shot) => sum + shot.duration, 0) : 0),
    [plan],
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <header className="mb-5">
        <p className="eyebrow">Director · Auto</p>
        <h1 className="mt-1.5 flex items-center gap-2 text-[26px] font-semibold text-white">
          自动导演
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
          <span className="brand-text">一句话进，成片出</span>
        </h1>
        <p className="mt-1.5 text-[12.5px] text-mist-400">
          给出方向与关键词，AI 自动写分镜、生成画面、质检修复、串成片子。中间过程不用管。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card p-4">
          <div className="mb-4 flex gap-1 rounded-xl bg-ink-900 p-1">
            {[
              ['single', '单条'],
              ['batch', '批量'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={clsx(
                  'flex-1 rounded-lg py-1.5 text-[12.5px] transition',
                  mode === key ? 'bg-ink-700 text-white' : 'text-mist-400 hover:text-mist-200',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'single' ? (
            <>
              <Field label="创作方向">
                <Textarea
                  rows={2}
                  value={form.direction}
                  onChange={set('direction')}
                  placeholder="例如：都市女性周末独自旅行的治愈短片"
                />
              </Field>
              <Field label="关键词" hint="用逗号分隔，越具体越好">
                <Input value={form.keywords} onChange={set('keywords')} placeholder="清晨, 咖啡, 街角, 阳光, 慢节奏" />
              </Field>
            </>
          ) : (
            <Field
              label="批量方向"
              hint="每行一条；可用「方向|关键词」的写法。按顺序串行执行，一条完成再开下一条"
            >
              <Textarea
                rows={7}
                value={batchText}
                onChange={(event) => setBatchText(event.target.value)}
                className="font-mono text-[11.5px]"
                placeholder={'都市女性周末独自旅行|清晨,咖啡,阳光\n海边日落跑步|黄昏,慢动作,海风\n深夜书房写字|台灯,雨声,特写'}
              />
            </Field>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="成片时长（秒）">
              <Select value={form.totalSeconds} onChange={set('totalSeconds')}>
                {[15, 20, 30, 40, 50, 60].map((n) => <option key={n} value={n}>{n} 秒</option>)}
              </Select>
            </Field>
            <Field label="每镜时长">
              <Select value={form.shotSeconds} onChange={set('shotSeconds')}>
                {[5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
              </Select>
            </Field>
            <Field label="画幅">
              <Select value={form.size} onChange={set('size')}>
                {['9:16', '16:9', '1:1'].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="风格预设">
              <Select value={form.styleId} onChange={pickStyle}>
                {groupedStyles.map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value="">自定义</option>
              </Select>
            </Field>
          </div>

          {activeStyle && (
            <div className="-mt-1 mb-3 rounded-lg border border-ink-700 bg-ink-900/60 px-2.5 py-2 text-[10.5px] leading-relaxed text-mist-400">
              <p className="text-[11px] text-mist-300">{activeStyle.note}</p>
              {[
                ['镜头', activeStyle.camera],
                ['光线', activeStyle.lighting],
                ['调色', activeStyle.color],
                ['质感', activeStyle.texture],
                ['构图', activeStyle.composition],
              ].map(([key, value]) => (
                <p key={key} className="mt-0.5">
                  <span className="mr-1 inline-block w-7 shrink-0 text-mist-500">{key}</span>
                  {value}
                </p>
              ))}
            </div>
          )}

          {form.styleId === '' && (
            <Field label="自定义风格" hint="用一句话描述光线、镜头、材质与色调">
              <Input
                value={form.style}
                onChange={set('style')}
                placeholder="例如：阴天散射光，长焦压缩，低饱和冷调，轻微手持"
              />
            </Field>
          )}

          <Field label="提示词 AI" hint="负责写分镜与修复提示词；选中的不可用时会自动降级">
            <Select value={form.provider} onChange={set('provider')}>
              {(providers.length ? providers : [{ id: 'chatgpt2api', label: 'ChatGPT2API' }]).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}{item.textModel ? ` · ${item.textModel}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="人物设定" hint="可选；填了会在每段提示词里重复，提升一致性">
            <Input
              value={form.characterDescription}
              onChange={set('characterDescription')}
              placeholder="24 岁女性，黑色短发，米色风衣"
            />
          </Field>

          <Field label="人物参考图" hint="可选；最多 4 张同一人物的多角度照片，会作为身份锚点贯穿所有镜头">
            <div className="flex flex-wrap items-center gap-2">
              {refs.map((ref, index) => (
                <div key={ref.url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-ink-700">
                  <img src={ref.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setRefs((prev) => prev.filter((item) => item.url !== ref.url))}
                    className="absolute right-0 top-0 grid h-4 w-4 place-items-center bg-black/70 text-white"
                  >
                    <X size={9} />
                  </button>
                  <span className="absolute bottom-0 left-0 bg-black/60 px-1 font-mono text-[8px] text-white">
                    #{index + 1}
                  </span>
                </div>
              ))}
              {refs.length < 4 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-600 text-[10px] text-mist-400 transition hover:border-brand-500/50 hover:text-brand-300"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                  添加
                </button>
              )}
              <div className="flex w-full items-center gap-2 pt-1">
                <Input
                  value={refPrompt}
                  onChange={(event) => setRefPrompt(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') generateRef(); }}
                  placeholder="或用文字描述人物长相，AI 生成参考图"
                  className="h-8 min-w-0 flex-1 text-[11.5px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateRef}
                  loading={generating}
                  className="h-8 shrink-0 px-3"
                >
                  <Sparkles size={12} /> 生成
                </Button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => onPick(event.target.files)}
              />
            </div>
          </Field>

          <label className="mt-2 flex items-center gap-2 text-[12px] text-mist-300">
            <input type="checkbox" checked={form.chain} onChange={set('chain')} className="accent-brand-400" />
            使用续集链（每 3 段自动断开，避免身份漂移）
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {mode === 'single' ? (
              <>
                <Button variant="outline" onClick={draftPlan} loading={planning}>
                  <Sparkles size={14} /> 先看分镜
                </Button>
                <Button onClick={start} loading={starting}>
                  <Play size={14} /> 开始生产
                </Button>
                <span className="text-[11.5px] text-mist-400">
                  约 {Math.max(1, Math.round(form.totalSeconds / form.shotSeconds))} 个镜头
                </span>
              </>
            ) : (
              <>
                <Button onClick={startBatch} loading={starting}>
                  <Layers size={14} /> 批量提交
                </Button>
                <span className="text-[11.5px] text-mist-400">
                  共 {batchText.split(/\r?\n/).filter((line) => line.trim()).length} 条
                </span>
              </>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          {plan && mode === 'single' && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-mist-200">分镜预览</h2>
                <span className="font-mono text-[11px] text-brand-300">
                  {plan.shots.length} 镜 · {shotTotal}s
                </span>
              </div>
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {plan.shots.map((shot) => (
                  <div key={shot.index} className="rounded-lg border border-ink-700 bg-ink-900 p-2.5">
                    <div className="mb-1 flex items-center justify-between text-[11.5px]">
                      <span className="text-mist-200">{shot.label}</span>
                      <span className="font-mono text-[10.5px] text-mist-400">
                        {shot.duration}s{shot.continuation ? ' · 续集' : ''}
                      </span>
                    </div>
                    <p className="line-clamp-3 text-[11px] leading-relaxed text-mist-400">{shot.prompt}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {current && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-mist-200">当前任务</h2>
                <span className={clsx('rounded-md px-2 py-0.5 text-[11px]', statusTone(current.status))}>
                  {STATUS_TEXT[current.status] || current.status}
                </span>
              </div>
              <p className="text-[11.5px] text-mist-400">
                {current.plan?.title || current.brief?.direction || '未命名'}
                {current.stage ? ` · ${current.stage}` : ''}
              </p>
              {ACTIVE.has(current.status) && (
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-mist-300">
                  <Loader2 size={12} className="animate-spin text-brand-400" />
                  一条 10 秒片段通常需要几分钟
                </div>
              )}
              {current.output?.url && (
                <div className="mt-3 space-y-2">
                  <video src={current.output.url} controls className="w-full rounded-lg bg-black" />
                  <div className="flex items-center justify-between text-[11px] text-mist-400">
                    <span>
                      {current.output.totalSeconds || '—'}s · {current.output.shotCount || 0} 镜
                      {current.output.quality ? ` · 质检 ${current.output.quality.passed}/${current.output.quality.checked}` : ''}
                      {current.output.quality?.retried ? ` · 重试 ${current.output.quality.retried} 次` : ''}
                    </span>
                    <a href={current.output.url} download className="text-brand-300 hover:text-brand-200">下载</a>
                  </div>
                </div>
              )}
              {current.error && <p className="mt-2 text-[11.5px] leading-relaxed text-rose-300">{current.error}</p>}
              <div className="mt-3 flex items-center gap-3">
                {current.canvasId && (
                  <Link to={`/canvas?canvas=${current.canvasId}`} className="flex items-center gap-1.5 text-[11.5px] text-mist-400 hover:text-brand-300">
                    <Workflow size={12} /> 打开画布
                  </Link>
                )}
                {currentSettled && current.status === 'failed' && (
                  <button onClick={() => retry(current.id)} className="flex items-center gap-1.5 text-[11.5px] text-mist-400 hover:text-brand-300">
                    <RotateCcw size={12} /> 重新排队
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-mist-200">批量任务</h2>
              <button onClick={loadAll} className="text-mist-400 hover:text-brand-300"><RefreshCw size={12} /></button>
            </div>
            {batches.length === 0 ? (
              <p className="py-3 text-center text-[11.5px] text-mist-400">还没有批量记录</p>
            ) : (
              <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1">
                {batches.map((batch) => (
                  <div key={batch.batchId} className="rounded-lg border border-ink-700 bg-ink-900 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                      <span className="text-mist-200">批量 · {batch.total} 条</span>
                      <span className="font-mono text-[10.5px] text-brand-300">
                        {batch.done}/{batch.total}{batch.failed ? ` · 失败 ${batch.failed}` : ''}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {batch.productions.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setCurrent(item)}
                          className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left text-[10.5px] text-mist-400 hover:bg-ink-800"
                        >
                          <span className="truncate">{item.plan?.title || item.brief?.direction || '未命名'}</span>
                          <span className={clsx('ml-2 shrink-0', item.status === 'failed' ? 'text-rose-300' : item.status === 'completed' ? 'text-emerald-300' : 'text-mist-400')}>
                            {STATUS_TEXT[item.status] || item.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-mist-200">历史</h2>
              <span className="text-[10.5px] text-mist-400">{list.length} 条</span>
            </div>
            <div className="max-h-[220px] space-y-1 overflow-y-auto pr-1">
              {list.slice(0, 20).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrent(item)}
                  className={clsx(
                    'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11.5px] transition',
                    current?.id === item.id ? 'bg-ink-700 text-white' : 'text-mist-300 hover:bg-ink-800',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Clapperboard size={11} className="shrink-0 text-brand-400" />
                    <span className="truncate">{item.plan?.title || item.brief?.direction || '未命名'}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-mist-400">{fmtAgo(item.createdAt)}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
