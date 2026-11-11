import { useEffect, useRef, useState } from 'react';
import { X, Send, Loader2, Trash2, Copy, MessageSquare, Minimize2, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';

export default function ChatDrawer({ open, onClose }) {
  const toast = useToast();
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('muse-spark');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.chatModels().then((d) => {
      setModels(d.models || []);
      if (d.models?.length) setModel(d.models[0].id);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const out = await api.chat({ messages: next, model });
      setMessages([...next, { role: 'assistant', content: out.content || '（空响应）' }]);
    } catch (e) {
      toast(e.message, 'error');
      setMessages(next);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板', 'ok');
    } catch {
      toast('复制失败', 'error');
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-[#1e2432] bg-ink-900/95 backdrop-blur-xl fade-in">
        <div className="flex items-center justify-between border-b border-[#1e2432] px-4 py-3.5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <MessageSquare size={15} className="text-brand-400" /> 文本对话
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMessages([])}
              title="清空对话"
              className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white"
            >
              <Trash2 size={13} />
            </button>
            <button onClick={onClose} title="缩小到按钮" className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white">
              <Minimize2 size={13} />
            </button>
          </div>
        </div>

        {/* 模型 */}
        <div className="flex items-center gap-2 border-b border-[#1e2432] px-4 py-2">
          <span className="text-[10.5px] text-mist-400">文本模型</span>
          {models.length === 0 ? (
            <span className="text-[11px] text-mist-400">暂无文本模型</span>
          ) : (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-7 rounded-md border border-[#1e2432] bg-ink-850 px-2 font-mono text-[11px] text-mist-200 outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* 消息 */}
        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="grid place-items-center py-16 text-center">
              <Sparkles size={24} className="text-brand-400/60" />
              <p className="mt-2 text-[12px] text-mist-300">内置文本模型</p>
              <p className="mt-0.5 text-[11px] text-mist-400">写脚本、改提示词、拆镜头都可以问</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={clsx('flex gap-2', m.role === 'user' && 'justify-end')}>
                {m.role === 'assistant' && (
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/15 text-[10px] text-brand-300">
                    AI
                  </span>
                )}
                <div
                  className={clsx(
                    'max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-brand-500/15 text-mist-100'
                      : 'bg-[#12161f] text-mist-200'
                  )}
                >
                  {m.content}
                  {m.role === 'assistant' && (
                    <button
                      onClick={() => copy(m.content)}
                      className="mt-1.5 flex items-center gap-1 text-[10px] text-mist-400 hover:text-white"
                    >
                      <Copy size={10} /> 复制回答
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="flex items-center gap-2 text-[11.5px] text-mist-400">
              <Loader2 size={12} className="animate-spin text-brand-400" /> 正在生成…
            </div>
          )}
        </div>

        {/* 输入 */}
        <div className="border-t border-[#1e2432] p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={2}
              placeholder="和文本模型聊聊…（Enter 发送）"
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-[#1e2432] bg-ink-850 px-3 py-2 text-[12.5px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
            />
            <button
              onClick={send}
              disabled={busy}
              className="flex h-[44px] items-center gap-1.5 rounded-xl brand-gradient px-4 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发送
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
