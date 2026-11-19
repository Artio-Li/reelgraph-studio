import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Clapperboard, Copy, Download, ImagePlus, Loader2, Send, Sparkles, Upload, Wand2, Workflow, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

const RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3'];
const QUICK_SCENES = [
  { label: '街头随拍 UGC', style: '真实手机直出，手持轻微呼吸感，自然街光，保留皮肤纹理' },
  { label: '电影胶片叙事', style: 'ARRI Alexa 35 配 35mm 定焦浅景深，青橙低饱和胶片颗粒，单一画内主光' },
  { label: '商业产品特写', style: '100mm 微距镜头 f/8，柔光箱配轮廓勾边光，材质反射锐利纯净' },
  { label: '暗调霓虹夜戏', style: '24mm 广角 f/1.8，雨夜湿地面双色霓虹反射，高对比低明度电影感' },
];

export default function GeminiStudio() {
  const toast = useToast();
  const nav = useNavigate();
  const inputRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [provider, setProvider] = useState('gemini');
  const [tab, setTab] = useState('prompt');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [template, setTemplate] = useState('');
  const [style, setStyle] = useState(QUICK_SCENES[0].style);
  const [duration, setDuration] = useState(10);
  const [ratio, setRatio] = useState('9:16');
  const [textModel, setTextModel] = useState('');
  const [result, setResult] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [resolution, setResolution] = useState('1K');
  const [refs, setRefs] = useState([]);
  const [imageJob, setImageJob] = useState(null);

  useEffect(() => {
    api.geminiMeta().then((data) => {
      setMeta(data);
      const nextProvider = data.defaultProvider || 'gemini';
      const info = data.providers?.[nextProvider] || data;
      setProvider(nextProvider);
      setTextModel(info.defaults?.text || info.models?.text?.[0]?.id || '');
      setImageModel(info.defaults?.image || info.models?.image?.[0]?.id || '');
    }).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const switchProvider = (next) => {
    const info = meta?.providers?.[next];
    setProvider(next);
    setTextModel(info?.defaults?.text || info?.models?.text?.[0]?.id || '');
    setImageModel(info?.defaults?.image || info?.models?.image?.[0]?.id || '');
  };

  const generatePrompt = async () => {
    if (keywords.trim().length < 2) return toast('先输入关键词或具体需求', 'error');
    setBusy(true);
    try {
      const out = await api.generatePrompt({
        provider, keywords, template, style, duration, aspectRatio: ratio, model: textModel,
      });
      setResult(out.content || '');
      setImagePrompt(out.content || keywords);
      toast('专业提示词已生成', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const upload = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 4) return toast('人物参考图最多上传 4 张', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((items) => [...items, ...(out.files || [])].slice(0, 4));
      toast('参考图已添加', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const generateImage = async () => {
    if (imagePrompt.trim().length < 2) return toast('先输入人物或画面描述', 'error');
    setBusy(true);
    try {
      const out = await api.createImage({
        provider, model: imageModel, prompt: imagePrompt,
        size: ratio, resolution, images: refs.map((item) => item.url),
      });
      setImageJob(out.job);
      toast('定妆人物图已生成', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(result); toast('提示词已复制到剪贴板', 'ok'); }
    catch { toast('复制失败', 'error'); }
  };

  const sendToCreate = (payload) => {
    localStorage.setItem('rg_create_draft', JSON.stringify(payload));
    nav('/create');
  };

  const sendToDirector = (payload) => {
    localStorage.setItem('rg_director_draft', JSON.stringify(payload));
    nav('/director');
  };

  const providerInfo = meta?.providers?.[provider] || meta;
  const textModels = providerInfo?.models?.text || [];
  const imageModels = providerInfo?.models?.image || [];
  const availableProviders = Object.values(meta?.providers || {}).filter((item) => item.enabled);

  return (
    <div className="mx-auto max-w-[1260px] px-5 py-6 lg:px-7">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">AI · Creative Copilot</p>
          <h1 className="mt-1.5 flex items-center gap-2.5 text-[25px] font-semibold text-mist-100">
            AI 提示词与角色定妆台
          </h1>
          <p className="mt-1 text-[12.5px] text-mist-400">
            多引擎扩写电影级分镜提示词、生成高一致性角色定妆照，并一键流转至快捷创作、自动导演或无限画布。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta?.realismEnabled && <Badge tone="brand">真实拍摄增强已开启</Badge>}
          <Badge tone={meta?.enabled ? 'ok' : 'warn'}>
            {meta?.enabled ? `${providerInfo?.name || 'AI'} 在线` : '等待管理员配置 Provider'}
          </Badge>
        </div>
      </header>

      {/* 顶部模式与服务切换条 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-2xl border border-ink-700 bg-ink-850/90 p-1">
          {[
            ['prompt', '视频提示词扩写', Wand2],
            ['image', '角色定妆图生成', ImagePlus],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition',
                tab === key ? 'bg-ink-750 text-mist-100 shadow-sm' : 'text-mist-400 hover:text-mist-200',
              )}
            >
              <Icon size={14} className={tab === key ? 'text-brand-400' : ''} />
              {label}
            </button>
          ))}
        </div>

        {meta?.enabled && availableProviders.length > 0 && (
          <div className="flex items-center gap-2 rounded-2xl border border-ink-700 bg-ink-850/80 px-3 py-1.5">
            <span className="text-[11.5px] text-mist-400">AI 引擎</span>
            <div className="flex gap-1">
              {availableProviders.map((item) => (
                <button
                  key={item.id}
                  onClick={() => switchProvider(item.id)}
                  className={clsx(
                    'rounded-lg px-2.5 py-1 text-[12px] font-medium transition',
                    provider === item.id
                      ? 'border border-brand-500/35 bg-brand-500/15 text-brand-300'
                      : 'text-mist-300 hover:bg-ink-750',
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!meta?.enabled ? (
        <div className="card grid min-h-72 place-items-center p-8 text-center">
          <div>
            <Bot size={32} className="mx-auto text-amber-300" />
            <p className="mt-3 text-[15px] font-medium text-mist-100">AI Provider 尚未启用</p>
            <p className="mt-1 text-[12.5px] text-mist-400">
              请管理员前往「系统管理 → 设置」启用 ChatGPT2API、Antigravity 或 Gemini 官方 API。
            </p>
          </div>
        </div>
      ) : tab === 'prompt' ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,450px)_1fr]">
          <section className="card space-y-4 p-5">
            <Field label="核心创意或关键词" hint="描述人物、场景、动作或想传达的情绪即可">
              <Textarea
                rows={5}
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="例如：25岁都市女生清晨在街角咖啡店窗边看雨，手持咖啡杯抬头微笑，10秒治愈风"
              />
            </Field>

            <Field
              label="摄影质感基调"
              extra={(
                <div className="flex flex-wrap gap-1">
                  {QUICK_SCENES.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setStyle(s.style)}
                      className="rounded-md border border-ink-600/80 bg-ink-900/60 px-2 py-0.5 text-[10.5px] text-mist-300 transition hover:border-brand-500/50 hover:text-brand-300"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            >
              <Input value={style} onChange={(e) => setStyle(e.target.value)} />
            </Field>

            <Field label="参考提示词模板（可选）" hint="AI 会拆解其段落结构与专业度，不会生搬硬套原内容">
              <Textarea
                rows={5}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="粘贴一条你满意的提示词范本…"
              />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="目标时长">
                <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {[5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
                </Select>
              </Field>
              <Field label="画幅比例">
                <Select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                  {RATIOS.map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="文本模型">
                <Select value={textModel} onChange={(e) => setTextModel(e.target.value)}>
                  {textModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </Select>
              </Field>
            </div>

            <Button className="w-full" size="lg" loading={busy} onClick={generatePrompt}>
              <Sparkles size={15} /> 扩写电影级提示词
            </Button>
          </section>

          <section className="card flex min-h-[580px] flex-col p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[14.5px] font-semibold text-mist-100">扩写结果编辑器</h2>
                <p className="text-[11px] text-mist-400">支持直接微调文字，随后一键流转到下游工作台</p>
              </div>
              {result && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-mist-400">{result.length} 字</span>
                  <Button size="sm" variant="outline" onClick={copy}>
                    <Copy size={12} /> 复制
                  </Button>
                </div>
              )}
            </div>

            <Textarea
              className="min-h-[380px] flex-1 font-sans text-[13px] leading-relaxed"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="点击左侧「扩写电影级提示词」后，完整的分镜级描述会呈现在这里…"
            />

            {result && (
              <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-ink-700/70 pt-4">
                <Button
                  size="sm"
                  onClick={() => sendToCreate({ mode: 'video', prompt: result, duration, size: ['16:9', '9:16', '1:1'].includes(ratio) ? ratio : '9:16' })}
                >
                  <Send size={13} /> 带入快捷创作生成视频
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  onClick={() => { setImagePrompt(result); setTab('image'); }}
                >
                  <ImagePlus size={13} /> 先生成角色定妆图
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendToDirector({ direction: keywords || result.slice(0, 120), size: ['16:9', '9:16', '1:1'].includes(ratio) ? ratio : '9:16' })}
                >
                  <Clapperboard size={13} /> 转交自动导演拍成短片
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,450px)_1fr]">
          <section className="card space-y-4 p-5">
            <Field label="角色定妆 / 首帧画面描述" hint="越具体地描述面部特征、发型、服装材质与环境光，出图越稳定">
              <Textarea
                rows={9}
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="例如：26岁东亚女性，自然黑长直发，米色亚麻衬衫，站在午后落地窗前，柔和侧逆光，真实单反人像质感…"
              />
            </Field>

            <Field label="多角度参考照片（可选，最多 4 张）" hint="上传已有角色图可做换景定妆或保持五官一致">
              <div className="flex flex-wrap gap-2.5">
                {refs.map((item, idx) => (
                  <div key={item.url} className="group relative h-18 w-18 overflow-hidden rounded-xl border border-ink-600">
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setRefs((list) => list.filter((x) => x.url !== item.url))}
                      className="absolute right-1 top-1 rounded-full bg-black/75 p-1 text-white"
                    >
                      <X size={10} />
                    </button>
                    <span className="absolute bottom-0 left-0 bg-black/65 px-1.5 font-mono text-[9px] text-white">#{idx + 1}</span>
                  </div>
                ))}
                {refs.length < 4 && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex h-18 w-18 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-600 text-[10.5px] text-mist-400 transition hover:border-brand-500/60 hover:text-brand-300"
                  >
                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    上传
                  </button>
                )}
              </div>
              <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="构图比例">
                <Select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                  {RATIOS.map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="输出规格">
                <Select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  {['1K', '2K', '4K'].map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="生图模型">
                <Select value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
                  {imageModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </Select>
              </Field>
            </div>

            <Button className="w-full" size="lg" loading={busy} onClick={generateImage}>
              <Sparkles size={15} /> 生成定妆人物图
            </Button>
          </section>

          <section className="card flex min-h-[580px] flex-col items-center justify-center overflow-hidden p-5">
            {imageJob?.mediaUrl ? (
              <div className="flex w-full flex-col items-center">
                <div className="overflow-hidden rounded-2xl border border-ink-700 bg-black/40 p-2 shadow-2xl">
                  <img src={imageJob.mediaUrl} alt="AI 生成人物" className="max-h-[62vh] rounded-xl object-contain" />
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                  <Button
                    size="sm"
                    onClick={() => sendToDirector({ refUrl: imageJob.mediaUrl, characterDescription: imagePrompt.slice(0, 180) })}
                  >
                    <Clapperboard size={13} /> 作为角色锚点带入自动导演
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => {
                      localStorage.setItem('reelgraph_canvas_import', JSON.stringify({
                        url: imageJob.mediaUrl, prompt: imagePrompt, provider, at: Date.now(),
                      }));
                      nav('/canvas');
                    }}
                  >
                    <Workflow size={13} /> 放入无限画布
                  </Button>
                  <a href={imageJob.mediaUrl} download>
                    <Button size="sm" variant="outline">
                      <Download size={13} /> 下载原图
                    </Button>
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center text-mist-400">
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-ink-700 bg-ink-850 text-brand-400">
                  <ImagePlus size={24} />
                </div>
                <p className="text-[14px] font-medium text-mist-200">定妆预览监视器</p>
                <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-mist-400">
                  生成的人物定妆图可直接作为自动导演或无限画布的身份锁定锚点，确保多镜头五官零漂移。
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
