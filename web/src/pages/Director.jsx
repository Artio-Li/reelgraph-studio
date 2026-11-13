import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard, Loader2, Play, RefreshCw, Sparkles, Wand2, Workflow } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtBytes } from '../lib/api.js';
import { Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

const ACTIVE = new Set(['planning', 'running', 'assembling']);

const STATUS_TEXT = {
  planning: '规划分镜中',
  running: '生成中',
  assembling: '合成成片',
  completed: '已完成',
  failed: '失败',
};

export default function Director() {
  const toast = useToast();
  const [form, setForm] = useState({
    direction: '',
    keywords: '',
    totalSeconds: 30,
    shotSeconds: 10,
    size: '9:16',
    style: '真实拍摄质感，自然光',
    characterDescription: '',
    chain: false,
  });
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [current, setCurrent] = useState(null);
  const [list, setList] = useState([]);

  const set = (key) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadList = useCallback(async () => {
    try {
      const out = await api.productions();
      setList(out.productions || []);
      const active = (out.productions || []).find((item) => ACTIVE.has(item.status));
      if (active) setCurrent((prev) => (prev && prev.id === active.id ? prev : active));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // 有进行中的任务就轮询
  useEffect(() => {
    if (!current || !ACTIVE.has(current.status)) return undefined;
    const timer = setInterval(async () => {
      try {
        const out = await api.production(current.id);
        setCurrent(out.production);
        if (!ACTIVE.has(out.production.status)) {
          setList((prev) => prev.map((item) => (item.id === out.production.id ? out.production : item)));
          if (out.production.status === 'completed') toast('成片已生成', 'ok');
          if (out.production.status === 'failed') toast(out.production.error || '生产失败', 'error');
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [current, toast]);

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
      const out = await api.createProduction(form);
      setCurrent(out.production);
      setPlan(null);
      await loadList();
      toast('已提交生产，可离开页面，完成后会保留结果', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setStarting(false);
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
          给出方向与关键词，AI 自动写分镜、生成画面、串成片子。中间过程不用管。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左：表单 */}
        <section className="card p-4">
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
            <Field label="风格">
              <Input value={form.style} onChange={set('style')} />
            </Field>
          </div>

          <Field label="人物设定" hint="可选；填了会在每段提示词里重复，提升一致性">
            <Input
              value={form.characterDescription}
              onChange={set('characterDescription')}
              placeholder="24 岁女性，黑色短发，米色风衣"
            />
          </Field>

          <label className="mt-2 flex items-center gap-2 text-[12px] text-mist-300">
            <input type="checkbox" checked={form.chain} onChange={set('chain')} className="accent-brand-400" />
            使用续集链（镜头之间动作连续；每 3 段自动断开一次，避免身份漂移）
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={draftPlan} loading={planning}>
              <Sparkles size={14} /> 先看分镜
            </Button>
            <Button onClick={start} loading={starting}>
              <Play size={14} /> 开始生产
            </Button>
            <span className="text-[11.5px] text-mist-400">
              约 {Math.max(1, Math.round(form.totalSeconds / form.shotSeconds))} 个镜头
            </span>
          </div>
        </section>

        {/* 右：分镜预览 / 进度 */}
        <aside className="space-y-4">
          {plan && (
            <section className="card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-mist-200">分镜预览</h2>
                <span className="font-mono text-[11px] text-brand-300">
                  {plan.shots.length} 镜 · {shotTotal}s
                </span>
              </div>
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
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
                <h2 className="text-[13px] font-medium text-mist-200">当前生产</h2>
                <span className={clsx(
                  'rounded-md px-2 py-0.5 text-[11px]',
                  current.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300'
                    : current.status === 'failed' ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-brand-500/15 text-brand-300',
                )}>
                  {STATUS_TEXT[current.status] || current.status}
                </span>
              </div>
              <p className="text-[11.5px] text-mist-400">{current.stage}</p>
              {ACTIVE.has(current.status) && (
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-mist-300">
                  <Loader2 size={12} className="animate-spin text-brand-400" />
                  生成一条 10 秒片段通常需要几分钟，可以先去忙别的
                </div>
              )}
              {current.output?.url && (
                <div className="mt-3 space-y-2">
                  <video src={current.output.url} controls className="w-full rounded-lg bg-black" />
                  <div className="flex items-center justify-between text-[11px] text-mist-400">
                    <span>{current.output.totalSeconds || '—'}s · {current.output.shotCount || 0} 镜</span>
                    <a href={current.output.url} download className="text-brand-300 hover:text-brand-200">
                      下载 mp4
                    </a>
                  </div>
                </div>
              )}
              {current.error && <p className="mt-2 text-[11.5px] leading-relaxed text-rose-300">{current.error}</p>}
              {current.canvasId && (
                <Link
                  to={`/canvas?canvas=${current.canvasId}`}
                  className="mt-3 flex items-center gap-1.5 text-[11.5px] text-mist-400 hover:text-brand-300"
                >
                  <Workflow size={12} /> 打开这次生产的画布
                </Link>
              )}
            </section>
          )}

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-medium text-mist-200">历史</h2>
              <button onClick={loadList} className="text-mist-400 hover:text-brand-300">
                <RefreshCw size={12} />
              </button>
            </div>
            {list.length === 0 ? (
              <p className="py-4 text-center text-[11.5px] text-mist-400">还没有生产记录</p>
            ) : (
              <div className="max-h-[240px] space-y-1 overflow-y-auto pr-1">
                {list.map((item) => (
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
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
