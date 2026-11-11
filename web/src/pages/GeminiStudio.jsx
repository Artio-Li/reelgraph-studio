import { useEffect, useRef, useState } from 'react';
import { Bot, Copy, ImagePlus, Loader2, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Select, Textarea, useToast } from '../components/ui.jsx';

const RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3'];

export default function GeminiStudio() {
  const toast = useToast();
  const inputRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState('prompt');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keywords, setKeywords] = useState('');
  const [template, setTemplate] = useState('');
  const [style, setStyle] = useState('写实真人质感，真实手机直出');
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
      setTextModel(data.defaults?.text || data.models?.text?.[0]?.id || '');
      setImageModel(data.defaults?.image || data.models?.image?.[0]?.id || '');
    }).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const generatePrompt = async () => {
    if (keywords.trim().length < 2) return toast('先输入关键词或具体需求', 'error');
    setBusy(true);
    try {
      const out = await api.generatePrompt({
        keywords, template, style, duration, aspectRatio: ratio, model: textModel,
      });
      setResult(out.content || '');
      setImagePrompt(out.content || keywords);
      toast('提示词生成完成', 'ok');
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
    } catch (e) { toast(e.message, 'error'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const generateImage = async () => {
    if (imagePrompt.trim().length < 2) return toast('先输入人物图描述', 'error');
    setBusy(true);
    try {
      const out = await api.createImage({
        provider: 'gemini', model: imageModel, prompt: imagePrompt,
        size: ratio, resolution, images: refs.map((item) => item.url),
      });
      setImageJob(out.job);
      toast('人物图生成完成', 'ok');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(result); toast('提示词已复制', 'ok'); }
    catch { toast('复制失败', 'error'); }
  };

  const textModels = meta?.models?.text || [];
  const imageModels = meta?.models?.image || [];

  return (
    <div className="mx-auto max-w-7xl p-5 lg:p-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Gemini · Creative Copilot</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Gemini 创作台</h1>
          <p className="mt-1 text-[12.5px] text-mist-400">关键词扩写专业视频提示词，并用参考图生成统一人物形象。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {meta?.realismEnabled && <Badge tone="brand">真实拍摄模式</Badge>}
          <Badge tone={meta?.enabled ? 'ok' : 'warn'}>{meta?.enabled ? 'Gemini 已连接' : '等待管理员配置'}</Badge>
        </div>
      </div>

      <div className="mb-4 flex w-fit gap-1 rounded-xl bg-ink-850 p-1">
        {[['prompt', '提示词生成', Wand2], ['image', '人物图生成', ImagePlus]].map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px]', tab === key ? 'bg-ink-700 text-white' : 'text-mist-400 hover:text-white')}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {!meta?.enabled ? (
        <div className="card grid min-h-64 place-items-center p-8 text-center">
          <div><Bot size={30} className="mx-auto text-amber-300" /><p className="mt-3 text-mist-200">Gemini 尚未启用</p><p className="mt-1 text-[12px] text-mist-400">请管理员进入“管理员 → 设置”填写官方 API Key 并测试连接。</p></div>
        </div>
      ) : tab === 'prompt' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,430px)_1fr]">
          <section className="card space-y-4 p-5">
            <Field label="关键词或需求"><Textarea rows={7} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="例如：中国女生、夜晚街头、冷脸、手机自拍、10秒" /></Field>
            <Field label="优质模板（可选）" hint="Gemini 学习模板的结构和专业程度，不会机械照抄。"><Textarea rows={8} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="粘贴你已有的优质提示词模板…" /></Field>
            <Field label="风格"><Input value={style} onChange={(e) => setStyle(e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="时长"><Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>{[5, 8, 10, 15].map((n) => <option key={n} value={n}>{n}秒</option>)}</Select></Field>
              <Field label="画幅"><Select value={ratio} onChange={(e) => setRatio(e.target.value)}>{RATIOS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <Field label="模型"><Select value={textModel} onChange={(e) => setTextModel(e.target.value)}>{textModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</Select></Field>
            </div>
            <Button className="w-full" loading={busy} onClick={generatePrompt}><Sparkles size={14} /> 生成专业提示词</Button>
          </section>
          <section className="card flex min-h-[620px] flex-col p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-[14px] font-semibold text-white">生成结果</h2>{result && <Button size="sm" variant="outline" onClick={copy}><Copy size={12} /> 复制</Button>}</div>
            <Textarea className="min-h-0 flex-1" value={result} onChange={(e) => setResult(e.target.value)} placeholder="生成结果会出现在这里，也可以继续手动修改。" />
            {result && <Button className="mt-3" variant="soft" onClick={() => { setImagePrompt(result); setTab('image'); }}><ImagePlus size={13} /> 用这段描述生成人物图</Button>}
          </section>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_1fr]">
          <section className="card space-y-4 p-5">
            <Field label="人物图描述"><Textarea rows={12} value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} placeholder="描述人物脸部、发型、服装、姿势、场景和光线…" /></Field>
            <div><p className="mb-2 text-[13px] font-medium text-mist-300">人物参考图（最多4张）</p><div className="grid grid-cols-5 gap-2">{refs.map((item) => <div key={item.url} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-600"><img src={item.url} alt="" className="h-full w-full object-cover" /><button onClick={() => setRefs((list) => list.filter((x) => x.url !== item.url))} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X size={10} /></button></div>)}{refs.length < 4 && <button onClick={() => inputRef.current?.click()} className="grid aspect-square place-items-center rounded-lg border border-dashed border-ink-500 text-mist-400 hover:border-brand-500 hover:text-brand-300">{uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}</button>}</div><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} /></div>
            <div className="grid grid-cols-3 gap-3"><Field label="比例"><Select value={ratio} onChange={(e) => setRatio(e.target.value)}>{RATIOS.map((x) => <option key={x}>{x}</option>)}</Select></Field><Field label="清晰度"><Select value={resolution} onChange={(e) => setResolution(e.target.value)}>{['1K', '2K', '4K'].map((x) => <option key={x}>{x}</option>)}</Select></Field><Field label="模型"><Select value={imageModel} onChange={(e) => setImageModel(e.target.value)}>{imageModels.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</Select></Field></div>
            <Button className="w-full" loading={busy} onClick={generateImage}><Sparkles size={14} /> 生成人物图</Button>
          </section>
          <section className="card grid min-h-[620px] place-items-center overflow-hidden p-5">{imageJob?.mediaUrl ? <div className="w-full"><img src={imageJob.mediaUrl} alt="Gemini 生成人物" className="mx-auto max-h-[70vh] rounded-xl object-contain" /><div className="mt-3 flex justify-center gap-2"><a href={imageJob.mediaUrl} download><Button variant="outline">下载图片</Button></a><Button variant="soft" onClick={() => { localStorage.setItem('reelgraph_canvas_import', JSON.stringify({ url: imageJob.mediaUrl, prompt: imagePrompt, at: Date.now() })); window.location.assign('/canvas'); }}>放入无限画布</Button></div></div> : <div className="text-center text-mist-400"><ImagePlus size={30} className="mx-auto mb-3 text-brand-400/60" /><p className="text-[13px]">生成结果会显示在这里</p><p className="mt-1 text-[11px]">参考图越清晰，人物脸部和服装越稳定</p></div>}</section>
        </div>
      )}
    </div>
  );
}
