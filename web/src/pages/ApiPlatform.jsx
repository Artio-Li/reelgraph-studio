import { useEffect, useState } from 'react';
import { Code2, KeyRound, Plus, Copy, Trash2, Loader2, CheckCircle2, Terminal, BookOpen } from 'lucide-react';
import { api, fmtAgo } from '../lib/api.js';
import { useToast } from '../components/ui.jsx';

const SNIPPETS = [
  {
    label: '文生视频',
    code: `curl -X POST "$BASE/v1/videos" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "雨夜霓虹街头，镜头缓慢推进",
    "duration": 5,
    "size": "16:9"
  }'`,
  },
  {
    label: '查询任务',
    code: `curl "$BASE/v1/videos/<task_id>" \\
  -H "Authorization: Bearer $KEY"`,
  },
  {
    label: '文生图',
    code: `curl -X POST "$BASE/v1/images/generations" \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"赛博朋克柴犬","size":"1:1"}'`,
  },
  {
    label: 'OpenAI SDK',
    code: `from openai import OpenAI

client = OpenAI(base_url="<BASE>/v1", api_key="<KEY>")
resp = client.chat.completions.create(
    model="muse-spark",
    messages=[{"role": "user", "content": "写一句赛博朋克标语"}],
)
print(resp.choices[0].message.content)`,
  },
];

export default function ApiPlatform() {
  const toast = useToast();
  const [keys, setKeys] = useState([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState(null);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState('');

  const load = () => {
    api.keys()
      .then((d) => {
        setKeys(d.keys || []);
        setBaseUrl(d.baseUrl?.startsWith('/') ? location.origin + d.baseUrl : (d.baseUrl || location.origin + '/v1'));
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const name = window.prompt('密钥名称', '我的密钥');
    if (!name) return;
    setCreating(true);
    try {
      const out = await api.createKey(name);
      setFresh(out);
      load();
      toast('密钥已创建，请立刻复制保存', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const remove = async (k) => {
    if (!confirm(`删除密钥「${k.name}」？调用会立即失效。`)) return;
    try {
      await api.deleteKey(k.id);
      setKeys((l) => l.filter((x) => x.id !== k.id));
      toast('已删除', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
      toast('已复制', 'ok');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const snippet = SNIPPETS[tab].code
    .replaceAll('$BASE', baseUrl)
    .replaceAll('<BASE>', baseUrl)
    .replaceAll('$KEY', fresh?.key || 'sk-xm-...')
    .replaceAll('<KEY>', fresh?.key || 'sk-xm-...');

  return (
    <div className="mx-auto max-w-[1100px] px-8 pb-20 pt-6">
      <p className="eyebrow">API Platform</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Code2 size={24} className="text-brand-400" strokeWidth={1.6} />
        API 平台
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">
        OpenAI 兼容接口，站内积分统一计费；密钥泄露请立即删除重建
      </p>

      {/* Base URL */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[#1a2030] bg-[#0b0f17]/70 px-4 py-3">
        <span className="text-[12px] text-mist-400">Base URL</span>
        <code className="rounded-lg bg-black/40 px-2.5 py-1 font-mono text-[11.5px] text-brand-300">{baseUrl}</code>
        <button
          onClick={() => copy(baseUrl, 'base')}
          className="flex items-center gap-1 text-[11.5px] text-mist-300 transition hover:text-white"
        >
          {copied === 'base' ? <CheckCircle2 size={11} /> : <Copy size={11} />} 复制
        </button>
        <span className="ml-auto font-mono text-[10.5px] text-mist-400">兼容 /v1/chat/completions · /v1/images · /v1/videos</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* 密钥 */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-mist-200">
              <KeyRound size={14} className="text-brand-400" /> API 密钥
            </h2>
            <button
              onClick={create}
              disabled={creating}
              className="flex items-center gap-1 rounded-lg brand-gradient px-3 py-1.5 text-[11.5px] font-medium text-white disabled:opacity-50"
            >
              {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} 新建
            </button>
          </div>

          {fresh && (
            <div className="mb-3 rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
              <p className="text-[11.5px] text-brand-300">新建的密钥（只显示这一次）</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-mist-100">{fresh.key}</code>
                <button onClick={() => copy(fresh.key, 'fresh')} className="shrink-0 text-mist-300 hover:text-white">
                  {copied === 'fresh' ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid place-items-center py-10 text-brand-400"><Loader2 size={18} className="animate-spin" /></div>
          ) : keys.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-mist-400">还没有密钥，点「新建」生成一个</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#1e2432] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-mist-200">{k.name}</p>
                    <p className="font-mono text-[10.5px] text-mist-400">{k.key}</p>
                    <p className="mt-0.5 font-mono text-[9.5px] text-ink-500">
                      {k.lastUsed ? `最近调用 ${fmtAgo(k.lastUsed)}` : '从未调用'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => copy(k.full, k.id)} className="rounded p-1.5 text-mist-400 hover:text-white">
                      {copied === k.id ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                    </button>
                    <button onClick={() => remove(k)} className="rounded p-1.5 text-mist-400 hover:text-rose-400">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 示例 */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-semibold text-mist-200">
              <Terminal size={14} className="text-brand-400" /> 调用示例
            </h2>
            <button onClick={() => copy(snippet, 'snip')} className="flex items-center gap-1 text-[11px] text-mist-400 hover:text-white">
              {copied === 'snip' ? <CheckCircle2 size={11} /> : <Copy size={11} />} 复制
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-1">
            {SNIPPETS.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setTab(i)}
                className={
                  'rounded-lg px-2.5 py-1 text-[11px] transition ' +
                  (tab === i ? 'bg-[#182030] text-white' : 'text-mist-400 hover:text-mist-200')
                }
              >
                {s.label}
              </button>
            ))}
          </div>

          <pre className="max-h-[300px] overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[10.5px] leading-relaxed text-mist-300">
            {snippet}
          </pre>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60 px-4 py-3">
        <BookOpen size={14} className="mt-0.5 shrink-0 text-brand-400" />
        <p className="text-[11.5px] leading-relaxed text-mist-400">
          计费与站内一致：视频 = 基础价 + 每秒单价 × 时长，图片按单价扣；调用使用当前账号积分，失败自动退还。
          上游目前由 muse.ai 账号池驱动，账号过期会导致 401，需重新绑定。
        </p>
      </div>
    </div>
  );
}
