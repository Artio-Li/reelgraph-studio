import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow,
  addEdge, getOutgoers, useEdgesState, useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Box, Film, Image as ImageIcon, LayoutGrid, Loader2, Play, Plus, RefreshCw,
  Save, Sparkles, Trash2, Type, Upload, X, Bot, Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

const LEGACY_KEY = 'xm_canvas_v1';
const IMPORT_KEY = 'reelgraph_canvas_import';
const ACTIVE = new Set(['queued', 'submitting', 'processing']);
const LINK_RULES = new Set([
  'text:text>video:prompt',
  'image:image>video:ref',
  'geminiImage:image>video:ref',
  'character:images>video:ref',
  'image:image>character:image',
  'geminiImage:image>character:image',
  'text:text>geminiImage:prompt',
  'geminiPrompt:text>geminiImage:prompt',
  'geminiPrompt:text>video:prompt',
  'image:image>geminiImage:ref',
  'video:video>storyboard:clip',
]);

let seq = 0;
const newId = (prefix = 'n_') => `${prefix}${Date.now().toString(36)}_${(++seq).toString(36)}`;

function initialDoc() {
  const textId = newId();
  const videoId = newId();
  return {
    version: 3,
    nodes: [
      { id: textId, type: 'text', position: { x: 120, y: 160 }, data: { label: '镜头提示词', content: '在这里输入画面描述' } },
      { id: videoId, type: 'video', position: { x: 510, y: 145 }, data: { label: '视频生成', prompt: '', duration: 5, size: '16:9' } },
    ],
    edges: [{
      id: newId('e_'), source: textId, sourceHandle: 'text', target: videoId, targetHandle: 'prompt',
      markerEnd: { type: MarkerType.ArrowClosed },
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function legacyDoc(raw) {
  if (!raw?.nodes?.length) return initialDoc();
  const nodes = raw.nodes.map((node, index) => ({
    id: node.id || newId(),
    type: ['text', 'image', 'video'].includes(node.type) ? node.type : 'text',
    position: node.position || { x: Number(node.x) || 140 + index * 260, y: Number(node.y) || 160 },
    data: node.type === 'text'
      ? { label: node.label || '文本', content: node.text || '' }
      : node.type === 'image'
        ? { label: node.label || '图片', url: node.mediaUrl || '' }
        : { label: node.label || '视频', prompt: node.text || '', duration: 5, size: '16:9' },
  }));
  return { version: 3, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

function cleanNode(node) {
  const { selected, dragging, resizing, width, height, measured, __runtime, ...rest } = node;
  return { ...rest, data: { ...(node.data || {}) } };
}

function nodeTitle(data, fallback) {
  return String(data?.label || fallback);
}

function Status({ runtime }) {
  if (!runtime) return null;
  const tone = runtime.status === 'completed'
    ? 'text-emerald-300 bg-emerald-500/10'
    : runtime.status === 'failed'
      ? 'text-rose-300 bg-rose-500/10'
      : 'text-brand-300 bg-brand-500/10';
  return (
    <span className={clsx('rounded px-1.5 py-0.5 text-[9px]', tone)}>
      {runtime.cached ? '缓存' : runtime.status === 'completed' ? '完成' : runtime.status === 'failed' ? '失败' : `${runtime.progress || 0}%`}
    </span>
  );
}

function Card({ children, tone = 'brand' }) {
  const border = tone === 'violet' ? 'border-violet-500/40' : tone === 'sky' ? 'border-sky-400/40' : 'border-brand-500/35';
  return <div className={clsx('min-w-[230px] overflow-hidden rounded-xl border bg-[#0d121b]/95 shadow-xl', border)}>{children}</div>;
}

function Header({ icon: Icon, title, tag, runtime }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
      <Icon size={13} className="text-brand-300" />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">{title}</span>
      <Status runtime={runtime} />
      <span className="font-mono text-[8px] text-mist-400">{tag}</span>
    </div>
  );
}

function TextNode({ data }) {
  return (
    <Card>
      <Header icon={Type} title={nodeTitle(data, '文本')} tag="TEXT" />
      <p className="nodrag line-clamp-4 min-h-16 whitespace-pre-wrap px-3 py-2.5 text-[10px] leading-relaxed text-mist-300">
        {data.content || '空文本'}
      </p>
      <Handle type="source" id="text" position={Position.Right} className="!h-2.5 !w-2.5 !border-brand-300 !bg-brand-500" />
    </Card>
  );
}

function ImageNode({ data }) {
  return (
    <Card tone="sky">
      <Header icon={ImageIcon} title={nodeTitle(data, '参考图')} tag="IMAGE" />
      {data.url
        ? <img src={data.url} alt="参考图" className="nodrag h-32 w-full object-cover" />
        : <div className="grid h-28 place-items-center text-[10px] text-mist-400">在右侧上传图片</div>}
      <Handle type="source" id="image" position={Position.Right} className="!h-2.5 !w-2.5 !border-sky-400 !bg-sky-400" />
    </Card>
  );
}

function GeminiPromptNode({ data }) {
  return (
    <Card tone="violet">
      <Header icon={Wand2} title={nodeTitle(data, 'Gemini 提示词')} tag="GEMINI · TEXT" />
      <p className="nodrag line-clamp-5 min-h-20 whitespace-pre-wrap px-3 py-2.5 text-[10px] leading-relaxed text-mist-300">
        {data.content || data.keywords || '在右侧输入关键词并生成'}
      </p>
      <Handle type="source" id="text" position={Position.Right} className="!h-2.5 !w-2.5 !border-violet-300 !bg-violet-500" />
    </Card>
  );
}

function GeminiImageNode({ data }) {
  return (
    <Card tone="sky">
      <Header icon={Bot} title={nodeTitle(data, 'Gemini 人物图')} tag="GEMINI · IMAGE" />
      {data.url
        ? <img src={data.url} alt="Gemini 人物图" className="nodrag h-36 w-full object-cover" />
        : <div className="grid h-28 place-items-center px-3 text-center text-[10px] text-mist-400">连接提示词和参考图后，在右侧点击生成</div>}
      <div className="px-3 py-2 font-mono text-[9px] text-mist-400">{data.size || '9:16'} · {data.resolution || '1K'}</div>
      <Handle type="target" id="prompt" position={Position.Left} style={{ top: '34%' }} className="!h-2.5 !w-2.5 !border-violet-300 !bg-violet-500" />
      <Handle type="target" id="ref" position={Position.Left} style={{ top: '70%' }} className="!h-2.5 !w-2.5 !border-sky-300 !bg-sky-500" />
      <Handle type="source" id="image" position={Position.Right} className="!h-2.5 !w-2.5 !border-sky-300 !bg-sky-500" />
    </Card>
  );
}

function CharacterNode({ data }) {
  return (
    <Card tone="violet">
      <Header icon={Box} title={nodeTitle(data, '角色参考')} tag="CHAR" />
      <div className="px-3 py-3 text-[10px] leading-relaxed text-mist-300">
        接入一张或多张图片，统一作为人物、服装与造型参考。
      </div>
      <Handle type="target" id="image" position={Position.Left} className="!h-2.5 !w-2.5 !border-sky-400 !bg-sky-400" />
      <Handle type="source" id="images" position={Position.Right} className="!h-2.5 !w-2.5 !border-violet-400 !bg-violet-500" />
    </Card>
  );
}

function VideoNode({ data }) {
  const runtime = data.__runtime;
  return (
    <Card>
      <Header icon={Film} title={nodeTitle(data, '视频生成')} tag="VIDEO" runtime={runtime} />
      {runtime?.mediaUrl ? (
        <video src={runtime.mediaUrl} controls playsInline className="nodrag nowheel h-36 w-full bg-black object-contain" />
      ) : (
        <div className="grid h-28 place-items-center bg-black/20 text-center text-[10px] text-mist-400">
          {runtime && ACTIVE.has(runtime.status)
            ? <span><Loader2 size={16} className="mx-auto mb-2 animate-spin text-brand-400" />正在生成 {runtime.progress || 0}%</span>
            : runtime?.error || '连接提示词与参考图后运行'}
        </div>
      )}
      <div className="flex items-center justify-between px-3 py-2 font-mono text-[9px] text-mist-400">
        <span>{data.duration || 5}s</span><span>{data.size || '16:9'}</span>
      </div>
      <Handle type="target" id="prompt" position={Position.Left} style={{ top: '34%' }} className="!h-2.5 !w-2.5 !border-brand-300 !bg-brand-500" />
      <Handle type="target" id="ref" position={Position.Left} style={{ top: '70%' }} className="!h-2.5 !w-2.5 !border-sky-400 !bg-sky-400" />
      <Handle type="source" id="video" position={Position.Right} className="!h-2.5 !w-2.5 !border-brand-300 !bg-brand-500" />
    </Card>
  );
}

function StoryboardNode({ data }) {
  return (
    <Card tone="violet">
      <Header icon={LayoutGrid} title={nodeTitle(data, '分镜板')} tag="BOARD" />
      <div className="px-3 py-3 text-[10px] leading-relaxed text-mist-300">
        用来归集多个视频镜头。当前版本负责视觉编排，后续可继续接合成导出。
      </div>
      <Handle type="target" id="clip" position={Position.Left} className="!h-2.5 !w-2.5 !border-violet-400 !bg-violet-500" />
    </Card>
  );
}

const nodeTypes = {
  text: TextNode, image: ImageNode, geminiPrompt: GeminiPromptNode, geminiImage: GeminiImageNode,
  character: CharacterNode, video: VideoNode, storyboard: StoryboardNode,
};

function Inspector({ node, updateNode, removeNode, uploadBusy, onUpload, onRun, runBusy, onRunAi, aiBusy, geminiMeta }) {
  if (!node) {
    return (
      <div className="px-4 py-6 text-[12px] leading-relaxed text-mist-400">
        选择一个节点后可在这里编辑。先用左侧工具添加节点，再从节点圆点拖线建立工作流。
      </div>
    );
  }
  const data = node.data || {};
  const patch = (next) => updateNode(node.id, next);
  return (
    <div className="space-y-4 px-4 py-4">
      <label className="block text-[11px] text-mist-300">
        节点名称
        <input value={data.label || ''} onChange={(e) => patch({ label: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] outline-none focus:border-brand-500" />
      </label>
      {node.type === 'text' && (
        <label className="block text-[11px] text-mist-300">
          提示词
          <textarea value={data.content || ''} onChange={(e) => patch({ content: e.target.value })} rows={12} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" />
        </label>
      )}
      {node.type === 'image' && (
        <div>
          <p className="mb-1.5 text-[11px] text-mist-300">参考图片</p>
          {data.url && <img src={data.url} alt="参考图" className="mb-2 max-h-40 w-full rounded-lg object-contain bg-black/30" />}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-ink-500 px-3 py-3 text-[11px] text-mist-300 hover:border-brand-500 hover:text-brand-300">
            {uploadBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {data.url ? '替换图片' : '上传图片'}
            <input type="file" accept="image/*" className="hidden" disabled={uploadBusy} onChange={(e) => onUpload(node.id, e.target.files?.[0])} />
          </label>
        </div>
      )}
      {node.type === 'geminiPrompt' && (
        <>
          <label className="block text-[11px] text-mist-300">关键词 / 需求
            <textarea value={data.keywords || ''} onChange={(e) => patch({ keywords: e.target.value })} rows={6} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" placeholder="人物、场景、动作、风格…" />
          </label>
          <label className="block text-[11px] text-mist-300">参考模板（可选）
            <textarea value={data.template || ''} onChange={(e) => patch({ template: e.target.value })} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-mist-300">时长
              <select value={data.duration || 10} onChange={(e) => patch({ duration: Number(e.target.value) })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{[5, 8, 10, 15].map((n) => <option key={n} value={n}>{n} 秒</option>)}</select>
            </label>
            <label className="text-[11px] text-mist-300">比例
              <select value={data.size || '9:16'} onChange={(e) => patch({ size: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{['9:16', '16:9', '1:1', '3:4', '4:3'].map((s) => <option key={s}>{s}</option>)}</select>
            </label>
          </div>
          <label className="block text-[11px] text-mist-300">文本模型
            <select value={data.model || geminiMeta?.defaults?.text || ''} onChange={(e) => patch({ model: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{(geminiMeta?.models?.text || []).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select>
          </label>
          {data.content && <label className="block text-[11px] text-mist-300">生成结果<textarea value={data.content} onChange={(e) => patch({ content: e.target.value })} rows={10} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" /></label>}
          <button onClick={() => onRunAi(node)} disabled={aiBusy || !geminiMeta?.enabled} className="flex w-full items-center justify-center gap-2 rounded-lg brand-gradient px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">{aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 生成提示词</button>
        </>
      )}
      {node.type === 'geminiImage' && (
        <>
          <label className="block text-[11px] text-mist-300">节点内补充描述（可选）
            <textarea value={data.prompt || ''} onChange={(e) => patch({ prompt: e.target.value })} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" placeholder="可连接文本节点，也可以在这里补充" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-mist-300">比例<select value={data.size || '9:16'} onChange={(e) => patch({ size: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{['9:16', '16:9', '1:1', '3:4', '4:3'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="text-[11px] text-mist-300">清晰度<select value={data.resolution || '1K'} onChange={(e) => patch({ resolution: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{['1K', '2K', '4K'].map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          <label className="block text-[11px] text-mist-300">图片模型<select value={data.model || geminiMeta?.defaults?.image || ''} onChange={(e) => patch({ model: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">{(geminiMeta?.models?.image || []).map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></label>
          {data.url && <img src={data.url} alt="生成结果" className="max-h-52 w-full rounded-lg bg-black/30 object-contain" />}
          <button onClick={() => onRunAi(node)} disabled={aiBusy || !geminiMeta?.enabled} className="flex w-full items-center justify-center gap-2 rounded-lg brand-gradient px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">{aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 生成人物图</button>
          <p className="text-[10px] leading-relaxed text-mist-400">将文本连到上方端口、参考图连到下方端口。生成结果可继续连接“角色参考”或“视频生成”。</p>
        </>
      )}
      {node.type === 'video' && (
        <>
          <label className="block text-[11px] text-mist-300">
            节点内补充提示词（可选）
            <textarea value={data.prompt || ''} onChange={(e) => patch({ prompt: e.target.value })} rows={5} className="mt-1.5 w-full resize-y rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-500" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-mist-300">时长
              <select value={data.duration || 5} onChange={(e) => patch({ duration: Number(e.target.value) })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">
                {[5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} 秒</option>)}
              </select>
            </label>
            <label className="text-[11px] text-mist-300">比例
              <select value={data.size || '16:9'} onChange={(e) => patch({ size: e.target.value })} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 py-2 text-[12px]">
                {['16:9', '9:16', '1:1', '4:3', '3:4'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <button onClick={() => onRun([node.id], false)} disabled={runBusy} className="flex w-full items-center justify-center gap-2 rounded-lg brand-gradient px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
            {runBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 运行此节点
          </button>
        </>
      )}
      <button onClick={() => removeNode(node.id)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300 hover:bg-rose-500/20">
        <Trash2 size={12} /> 删除节点
      </button>
    </div>
  );
}

export default function Canvas() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [canvases, setCanvases] = useState([]);
  const [canvas, setCanvas] = useState(null);
  const [name, setName] = useState('默认画布');
  const [selectedIds, setSelectedIds] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [nodeHistory, setNodeHistory] = useState([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [geminiMeta, setGeminiMeta] = useState(null);
  const flowRef = useRef(null);
  const revRef = useRef(1);
  const lastSavedRef = useRef('');
  const saveTimerRef = useRef(null);
  const saveChainRef = useRef(Promise.resolve());
  const latestRef = useRef({ nodes: [], edges: [], name: '默认画布', viewport: { x: 0, y: 0, zoom: 1 } });

  const runtime = useMemo(() => new Map([
    ...nodeHistory.map((item) => [item.nodeId, item]),
    ...(latestRun?.nodeRuns || []).map((item) => [item.nodeId, item]),
  ]), [latestRun, nodeHistory]);
  const displayNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: { ...node.data, __runtime: runtime.get(node.id) || null },
  })), [nodes, runtime]);
  const selectedNode = nodes.find((node) => selectedIds.includes(node.id)) || null;

  const snapshot = useCallback(() => ({
    version: 3,
    nodes: latestRef.current.nodes.map(cleanNode),
    edges: latestRef.current.edges.map((edge) => ({ ...edge, selected: undefined })),
    viewport: flowRef.current?.getViewport?.() || latestRef.current.viewport || { x: 0, y: 0, zoom: 1 },
  }), []);

  const persist = useCallback((targetId = canvas?.id) => {
    if (!targetId) return Promise.resolve();
    const doc = snapshot();
    const targetName = String(latestRef.current.name || '默认画布').trim() || '默认画布';
    const encoded = JSON.stringify({ name: targetName, doc });
    if (encoded === lastSavedRef.current) return saveChainRef.current;
    setSaving(true);
    const task = saveChainRef.current.then(async () => {
      if (encoded === lastSavedRef.current) return;
      const out = await api.saveCanvas(targetId, { name: targetName, doc, rev: revRef.current });
      revRef.current = out.canvas.rev;
      lastSavedRef.current = encoded;
      setCanvas(out.canvas);
      setCanvases((items) => items.map((item) => item.id === targetId
        ? { ...item, name: out.canvas.name, rev: out.canvas.rev, updatedAt: out.canvas.updatedAt }
        : item));
    });
    saveChainRef.current = task.catch((error) => {
      toast(error.message, 'error');
      throw error;
    }).finally(() => setSaving(false));
    return saveChainRef.current;
  }, [canvas?.id, snapshot, toast]);

  const hydrate = useCallback((record, run = null, history = []) => {
    const doc = record.doc || initialDoc();
    const hydratedEdges = (doc.edges || []).map((edge) => ({
      ...edge,
      markerEnd: edge.markerEnd || { type: MarkerType.ArrowClosed },
    }));
    setCanvas(record);
    setName(record.name);
    setNodes(doc.nodes || []);
    setEdges(hydratedEdges);
    setLatestRun(run);
    setNodeHistory(history);
    setViewport(doc.viewport || { x: 0, y: 0, zoom: 1 });
    setSelectedIds([]);
    revRef.current = record.rev;
    latestRef.current = { nodes: doc.nodes || [], edges: hydratedEdges, name: record.name, viewport: doc.viewport };
    lastSavedRef.current = JSON.stringify({ name: record.name, doc: { ...doc, edges: hydratedEdges } });
  }, [setEdges, setNodes]);

  const openCanvas = useCallback(async (id) => {
    setLoading(true);
    try {
      const out = await api.canvas(id);
      hydrate(out.canvas, out.latestRun, out.nodeState || []);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [hydrate, toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list = (await api.canvases()).canvases || [];
        if (!list.length) {
          let doc = initialDoc();
          try {
            const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
            if (old) doc = legacyDoc(old);
          } catch { /* ignore malformed old local data */ }
          const created = (await api.createCanvas({ name: '默认画布', doc })).canvas;
          list = [created];
          localStorage.removeItem(LEGACY_KEY);
        }
        if (cancelled) return;
        setCanvases(list);
        await openCanvas(list[0].id);
      } catch (error) {
        if (!cancelled) toast(error.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openCanvas, toast]);

  useEffect(() => {
    api.geminiMeta().then(setGeminiMeta).catch(() => setGeminiMeta({ enabled: false, models: { text: [], image: [] }, defaults: {} }));
  }, []);

  useEffect(() => {
    if (!canvas?.id || loading) return;
    try {
      const imported = JSON.parse(localStorage.getItem(IMPORT_KEY) || 'null');
      if (!imported?.url) return;
      localStorage.removeItem(IMPORT_KEY);
      const node = {
        id: newId(), type: 'geminiImage', position: { x: 280, y: 180 },
        data: { label: 'Gemini 人物图', url: imported.url, prompt: imported.prompt || '', size: '9:16', resolution: '1K', model: geminiMeta?.defaults?.image || '' },
      };
      setNodes((current) => [...current, node]);
      setSelectedIds([node.id]);
      toast('人物图已放入当前画布', 'ok');
    } catch { localStorage.removeItem(IMPORT_KEY); }
  }, [canvas?.id, loading, geminiMeta?.defaults?.image, setNodes, toast]);

  latestRef.current = {
    nodes, edges, name,
    viewport,
  };

  useEffect(() => {
    if (!canvas?.id || loading) return undefined;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persist(), 700);
    return () => clearTimeout(saveTimerRef.current);
  }, [nodes, edges, name, viewport, canvas?.id, loading, persist]);

  useEffect(() => {
    if (!latestRun?.id || !ACTIVE.has(latestRun.status)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const out = await api.canvasRun(latestRun.id);
        if (stopped) return;
        setLatestRun(out.run);
        if (ACTIVE.has(out.run.status)) setTimeout(poll, 2500);
        else {
          setNodeHistory((items) => {
            const merged = new Map(items.map((item) => [item.nodeId, item]));
            for (const item of out.run.nodeRuns || []) merged.set(item.nodeId, item);
            return [...merged.values()];
          });
          refresh();
          toast(out.run.status === 'failed' ? '画布运行失败' : '画布运行完成', out.run.status === 'failed' ? 'error' : 'ok');
        }
      } catch (error) {
        if (!stopped) setTimeout(poll, 4000);
      }
    };
    const timer = setTimeout(poll, 1800);
    return () => { stopped = true; clearTimeout(timer); };
  }, [latestRun?.id, latestRun?.status, refresh, toast]);

  const isValidConnection = useCallback((connection) => {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    const sig = `${source?.type}:${connection.sourceHandle}>${target?.type}:${connection.targetHandle}`;
    if (!LINK_RULES.has(sig) || connection.source === connection.target) return false;
    const graphNodes = nodes.map((node) => node.id === connection.source ? { ...node, data: { ...node.data } } : node);
    const outgoing = getOutgoers(source, graphNodes, [...edges, connection]);
    const seen = new Set();
    const reachesSource = (node) => {
      if (!node || seen.has(node.id)) return false;
      if (node.id === source.id) return true;
      seen.add(node.id);
      return getOutgoers(node, graphNodes, [...edges, connection]).some(reachesSource);
    };
    return !outgoing.some(reachesSource);
  }, [edges, nodes]);

  const onConnect = useCallback((connection) => {
    if (!isValidConnection(connection)) return toast('这两个端口不能连接，或连线会形成循环', 'error');
    setEdges((current) => addEdge({ ...connection, id: newId('e_'), markerEnd: { type: MarkerType.ArrowClosed } }, current));
  }, [isValidConnection, setEdges, toast]);

  const addNodeOf = (type) => {
    const point = flowRef.current?.screenToFlowPosition?.({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) || { x: 320, y: 220 };
    const defaults = {
      text: { label: '文本提示词', content: '' },
      image: { label: '参考图片', url: '' },
      geminiPrompt: { label: 'Gemini 提示词', keywords: '', template: '', content: '', duration: 10, size: '9:16', model: geminiMeta?.defaults?.text || '' },
      geminiImage: { label: 'Gemini 人物图', prompt: '', url: '', size: '9:16', resolution: '1K', model: geminiMeta?.defaults?.image || '' },
      character: { label: '角色参考' },
      video: { label: '视频生成', prompt: '', duration: 5, size: '16:9' },
      storyboard: { label: '分镜板' },
    };
    const node = { id: newId(), type, position: { x: point.x - 115, y: point.y - 70 }, data: defaults[type] };
    setNodes((current) => [...current, node]);
    setSelectedIds([node.id]);
  };

  const updateNode = (id, data) => setNodes((items) => items.map((node) => node.id === id ? { ...node, data: { ...node.data, ...data } } : node));
  const removeNode = (id) => {
    setNodes((items) => items.filter((node) => node.id !== id));
    setEdges((items) => items.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedIds((ids) => ids.filter((item) => item !== id));
  };

  const uploadImage = async (id, file) => {
    if (!file) return;
    setUploadBusy(true);
    try {
      const out = await api.upload([file]);
      const uploaded = out.files?.[0];
      if (!uploaded?.url) throw new Error('上传未返回图片地址');
      updateNode(id, { url: uploaded.url, fileName: uploaded.name });
      toast('图片已上传', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setUploadBusy(false);
    }
  };

  const runAiNode = async (node) => {
    if (!geminiMeta?.enabled) return toast('请管理员先配置并启用 Gemini', 'error');
    setAiBusy(true);
    try {
      if (node.type === 'geminiPrompt') {
        const out = await api.generatePrompt({
          keywords: node.data?.keywords,
          template: node.data?.template,
          duration: node.data?.duration || 10,
          aspectRatio: node.data?.size || '9:16',
          style: node.data?.style || '写实真人质感，真实物理光学表现',
          model: node.data?.model || geminiMeta.defaults?.text,
        });
        updateNode(node.id, { content: out.content, model: out.model });
        toast('Gemini 提示词已生成', 'ok');
        return;
      }
      if (node.type === 'geminiImage') {
        const incoming = edges.filter((edge) => edge.target === node.id);
        const promptParts = incoming.filter((edge) => edge.targetHandle === 'prompt').map((edge) => {
          const source = nodes.find((item) => item.id === edge.source);
          return String(source?.data?.content || '').trim();
        }).filter(Boolean);
        if (String(node.data?.prompt || '').trim()) promptParts.push(String(node.data.prompt).trim());
        const prompt = promptParts.join('\n\n').trim();
        if (prompt.length < 2) throw new Error('请连接提示词节点，或填写节点内补充描述');
        const images = incoming.filter((edge) => edge.targetHandle === 'ref').map((edge) => {
          const source = nodes.find((item) => item.id === edge.source);
          return source?.data?.url;
        }).filter(Boolean);
        if (!window.confirm(`将调用 Gemini 生成 1 张 ${node.data?.resolution || '1K'} 人物图，并扣除图片积分。继续吗？`)) return;
        const out = await api.createImage({
          provider: 'gemini', model: node.data?.model || geminiMeta.defaults?.image,
          prompt, images, size: node.data?.size || '9:16', resolution: node.data?.resolution || '1K',
        });
        updateNode(node.id, { url: out.job?.mediaUrl, jobId: out.job?.id, prompt, model: out.job?.params?.model || node.data?.model });
        refresh();
        toast('Gemini 人物图已生成', 'ok');
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const run = async (targetNodeIds = [], force = false) => {
    if (!canvas?.id || runBusy || ACTIVE.has(latestRun?.status)) return;
    setRunBusy(true);
    try {
      clearTimeout(saveTimerRef.current);
      await persist();
      const body = { targetNodeIds, force };
      const { preview } = await api.previewCanvasRun(canvas.id, body);
      const cacheText = preview.cached ? `，其中 ${preview.cached} 个命中缓存` : '';
      if (preview.estimatedCost > 0 && !window.confirm(`将生成 ${preview.toGenerate} 个视频节点${cacheText}，预计消耗 ${preview.estimatedCost} 积分。继续吗？`)) return;
      const out = await api.runCanvas(canvas.id, body);
      setLatestRun(out.run);
      if (!ACTIVE.has(out.run.status)) {
        setNodeHistory((items) => {
          const merged = new Map(items.map((item) => [item.nodeId, item]));
          for (const item of out.run.nodeRuns || []) merged.set(item.nodeId, item);
          return [...merged.values()];
        });
      }
      refresh();
      toast(preview.toGenerate ? '画布任务已提交' : '已直接复用缓存结果', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setRunBusy(false);
    }
  };

  const createCanvas = async () => {
    const input = window.prompt('新画布名称', `画布 ${canvases.length + 1}`);
    if (input == null) return;
    try {
      await persist();
      const created = (await api.createCanvas({ name: input.trim() || '未命名画布', doc: initialDoc() })).canvas;
      setCanvases((items) => [created, ...items]);
      await openCanvas(created.id);
    } catch (error) { toast(error.message, 'error'); }
  };

  const switchCanvas = async (id) => {
    if (id === canvas?.id) return;
    try { await persist(); await openCanvas(id); } catch (error) { toast(error.message, 'error'); }
  };

  const deleteCurrent = async () => {
    if (!canvas?.id || !window.confirm(`确定删除画布“${name}”及其运行记录吗？生成的视频任务不会被删除。`)) return;
    try {
      await api.deleteCanvas(canvas.id);
      const next = canvases.filter((item) => item.id !== canvas.id);
      setCanvases(next);
      if (next.length) await openCanvas(next[0].id);
      else {
        const created = (await api.createCanvas({ name: '默认画布', doc: initialDoc() })).canvas;
        setCanvases([created]);
        await openCanvas(created.id);
      }
      toast('画布已删除', 'ok');
    } catch (error) { toast(error.message, 'error'); }
  };

  if (loading && !canvas) return <div className="grid h-full place-items-center text-brand-400"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-ink-700 px-5 py-3">
        <div className="mr-2">
          <p className="eyebrow">Canvas · Workbench</p>
          <h1 className="mt-1 text-xl font-semibold text-white">无限画布</h1>
        </div>
        <select value={canvas?.id || ''} onChange={(e) => switchCanvas(e.target.value)} className="min-w-40 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] text-mist-200">
          {canvases.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="w-44 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-[12px] text-mist-200 outline-none focus:border-brand-500" />
        <button onClick={createCanvas} className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-[11px] text-mist-300 hover:text-white"><Plus size={12} /> 新画布</button>
        <button onClick={deleteCurrent} className="grid h-8 w-8 place-items-center rounded-lg border border-rose-500/25 text-rose-300 hover:bg-rose-500/10"><Trash2 size={13} /></button>
        <span className="flex items-center gap-1 text-[10px] text-mist-400">{saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}{saving ? '保存中' : '已自动保存'}</span>
        {geminiMeta?.realismEnabled && (
          <span className="rounded-full border border-brand-500/25 bg-brand-500/10 px-2 py-1 text-[10px] text-brand-300">真实拍摄模式</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => run([], true)} disabled={runBusy || ACTIVE.has(latestRun?.status)} title="忽略历史缓存，重新生成新的变体" className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-[11px] text-mist-300 hover:text-white disabled:opacity-40"><RefreshCw size={12} /> 强制新变体</button>
          <button onClick={() => run([], false)} disabled={runBusy || ACTIVE.has(latestRun?.status)} className="flex items-center gap-1.5 rounded-lg brand-gradient px-4 py-2 text-[12px] font-medium text-white disabled:opacity-45">
            {runBusy || ACTIVE.has(latestRun?.status) ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {ACTIVE.has(latestRun?.status) ? '运行中' : '运行全部视频节点'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="z-10 flex w-14 shrink-0 flex-col items-center gap-2 border-r border-ink-700 bg-ink-850 py-3">
          {[
            ['text', Type, '文本'], ['image', ImageIcon, '图片'], ['geminiPrompt', Wand2, 'AI提示词'],
            ['geminiImage', Bot, 'AI人物图'], ['character', Box, '角色'],
            ['video', Film, '视频'], ['storyboard', LayoutGrid, '分镜板'],
          ].map(([type, Icon, label]) => (
            <button key={type} onClick={() => addNodeOf(type)} title={`添加${label}节点`} className="grid h-9 w-9 place-items-center rounded-lg border border-ink-600 text-mist-400 hover:border-brand-500/60 hover:bg-brand-500/10 hover:text-brand-300"><Icon size={15} /></button>
          ))}
        </aside>

        <main className="relative min-w-0 flex-1 bg-[#080b12]">
          <ReactFlow
            key={canvas?.id}
            nodes={displayNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => { flowRef.current = instance; }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onMoveEnd={(_, nextViewport) => setViewport(nextViewport)}
            isValidConnection={isValidConnection}
            onSelectionChange={({ nodes: selected }) => setSelectedIds(selected.map((node) => node.id))}
            onNodesDelete={(removed) => {
              const ids = new Set(removed.map((node) => node.id));
              setEdges((items) => items.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
            }}
            defaultViewport={canvas?.doc?.viewport || { x: 0, y: 0, zoom: 1 }}
            minZoom={0.2}
            maxZoom={2.5}
            fitView={!canvas?.doc?.viewport}
            snapToGrid
            snapGrid={[12, 12]}
            deleteKeyCode={['Backspace', 'Delete']}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="#252c3a" />
            <MiniMap pannable zoomable nodeColor={(node) => node.type === 'video' ? '#0fa98a' : node.type === 'image' ? '#38c8f0' : '#8b5cf6'} maskColor="rgba(5,8,14,.75)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="pointer-events-none absolute left-4 top-3 rounded-lg border border-ink-700 bg-ink-900/80 px-3 py-2 text-[10px] text-mist-400 backdrop-blur">
            从节点圆点拖线连接 · 滚轮缩放 · 拖动空白处移动 · Delete 删除
          </div>
        </main>

        <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink-700 bg-ink-850">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <span className="text-[12px] font-medium text-white">节点设置</span>
            {selectedNode && <button onClick={() => setSelectedIds([])} className="text-mist-400 hover:text-white"><X size={13} /></button>}
          </div>
          <Inspector node={selectedNode} updateNode={updateNode} removeNode={removeNode} uploadBusy={uploadBusy} onUpload={uploadImage} onRun={run} runBusy={runBusy} onRunAi={runAiNode} aiBusy={aiBusy} geminiMeta={geminiMeta} />
          {latestRun && (
            <div className="mx-4 mb-4 rounded-xl border border-ink-600 bg-ink-900 p-3 text-[10px] text-mist-300">
              <div className="mb-2 flex items-center justify-between"><span>最近运行</span><span className={ACTIVE.has(latestRun.status) ? 'text-brand-300' : latestRun.status === 'failed' ? 'text-rose-300' : 'text-emerald-300'}>{latestRun.status}</span></div>
              <div className="flex justify-between text-mist-400"><span>实际费用</span><span>{latestRun.actualCost || 0} 积分</span></div>
              <div className="mt-1 flex justify-between text-mist-400"><span>节点</span><span>{latestRun.nodeRuns?.length || 0}</span></div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
