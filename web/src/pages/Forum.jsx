import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Send, Heart, Plus, Search, Loader2, X, CornerDownRight } from 'lucide-react';
import { clsx } from 'clsx';
import { api } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';
import { fmtAgo } from '../lib/api.js';

export default function Forum() {
  const { user } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState([{ key: 'all', label: '全部' }]);
  const [category, setCategory] = useState('all');
  const [posts, setPosts] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(false);
  const [openPost, setOpenPost] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.posts({ category, q });
      setCategories(out.categories);
      setPosts(out.posts);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [category, q, toast]);

  useEffect(() => { load(); }, [load]);

  const like = async (post) => {
    try {
      const out = await api.likePost(post.id);
      setPosts((list) => list.map((p) => (p.id === post.id ? { ...p, likes: out.likes, liked: out.liked } : p)));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="mx-auto max-w-[920px] px-8 pb-20 pt-6">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/25">
            <MessageCircle size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">吐槽小会</h1>
            <p className="mt-1 text-[12.5px] text-mist-400">畅所欲言，图文皆可，友善交流</p>
          </div>
        </div>
        <button
          onClick={() => setCompose(true)}
          className="flex items-center gap-1.5 rounded-full brand-gradient px-4 py-2 text-[12.5px] font-medium text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110"
        >
          <Send size={13} /> 发帖
        </button>
      </div>

      {/* 分类 */}
      <div className="mt-6 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={clsx(
              'rounded-full border px-3.5 py-1.5 text-[12px] transition',
              category === c.key
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                : 'border-[#1e2432] text-mist-300 hover:border-[#2c3448] hover:text-white'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div className="relative mt-3">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="搜索帖子标题或内容"
          className="h-11 w-full rounded-full border border-[#1e2432] bg-[#0d1119] pl-10 pr-4 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/40"
        />
      </div>

      {/* 列表 */}
      <div className="mt-3 space-y-3">
        {loading ? (
          <div className="grid place-items-center py-24 text-brand-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60 py-24 text-center">
            <p className="text-[13px] text-mist-300">还没有帖子</p>
            <p className="mt-1 text-[12px] text-mist-400">发第一帖，占个坑</p>
          </div>
        ) : (
          posts.map((p) => (
            <article key={p.id} className="rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60 p-4 transition hover:border-[#232c3e]">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10.5px] text-violet-300">
                  {categories.find((c) => c.key === p.category)?.label || p.category}
                </span>
                <h3 className="text-[14.5px] font-semibold text-white">{p.title}</h3>
              </div>
              {p.content && (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-mist-300">
                  {p.content}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-mist-400">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#1b2230] text-[9px] text-mist-300">
                    {(p.author?.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span>{p.author?.name}</span>
                  <span>·</span>
                  <span>{fmtAgo(p.createdAt)}</span>
                </div>
                <div className="flex items-center gap-4 text-[11.5px]">
                  <button
                    onClick={() => like(p)}
                    className={clsx('flex items-center gap-1 transition', p.liked ? 'text-brand-400' : 'text-mist-400 hover:text-mist-200')}
                  >
                    <Heart size={12} fill={p.liked ? 'currentColor' : 'none'} /> {p.likes}
                  </button>
                  <button
                    onClick={() => setOpenPost(p)}
                    className="flex items-center gap-1 text-mist-400 transition hover:text-mist-200"
                  >
                    <MessageCircle size={12} /> {p.replyCount} 回复
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      <ComposeModal
        open={compose}
        categories={categories.filter((c) => c.key !== 'all')}
        onClose={() => setCompose(false)}
        onDone={() => { setCompose(false); load(); }}
      />

      <PostModal post={openPost} onClose={() => setOpenPost(null)} onChanged={load} />
    </div>
  );
}

function ComposeModal({ open, categories, onClose, onDone }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(categories[0]?.key || 'chat');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setCategory(categories[0]?.key || 'chat'); }, [open, categories]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return toast('请填写标题', 'error');
    setBusy(true);
    try {
      await api.createPost({ title: title.trim(), content, category });
      setTitle(''); setContent('');
      toast('发布成功', 'ok');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1e2432] bg-ink-850 p-5 shadow-2xl fade-in">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-white">发帖</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white"><X size={15} /></button>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-[11.5px] transition',
                  category === c.key
                    ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                    : 'border-[#1e2432] text-mist-300 hover:text-white'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            className="h-10 w-full rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="说点什么…（图文皆可，友善交流）"
            className="w-full resize-none rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 py-2.5 text-[13px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-[#232a38] px-4 py-2 text-[12.5px] text-mist-300">取消</button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg brand-gradient px-4 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              {busy && <Loader2 size={12} className="animate-spin" />} 发布
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PostModal({ post, onClose, onChanged }) {
  const toast = useToast();
  const [replies, setReplies] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!post) return;
    api.replies(post.id).then((d) => setReplies(d.replies)).catch(() => {});
  }, [post]);

  if (!post) return null;

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.replyPost(post.id, text.trim());
      setText('');
      const d = await api.replies(post.id);
      setReplies(d.replies);
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-[#1e2432] bg-ink-850 shadow-2xl fade-in">
        <div className="flex items-start justify-between gap-3 border-b border-[#1e2432] p-5">
          <div>
            <h3 className="text-[15px] font-semibold text-white">{post.title}</h3>
            <p className="mt-1 text-[11px] text-mist-400">
              {post.author?.name} · {fmtAgo(post.createdAt)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {post.content && (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-mist-200">{post.content}</p>
          )}

          <div className="mt-5 space-y-3">
            {replies.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-mist-400">还没有回复</p>
            ) : (
              replies.map((r) => (
                <div key={r.id} className="flex gap-2.5">
                  <CornerDownRight size={13} className="mt-1 shrink-0 text-mist-400" />
                  <div className="min-w-0 flex-1 rounded-xl bg-ink-900/70 px-3 py-2">
                    <p className="text-[11px] text-mist-400">
                      {r.author?.name} · {fmtAgo(r.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-mist-200">{r.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-[#1e2432] p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="写回复…"
            className="h-10 flex-1 rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
          />
          <button
            onClick={send}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl brand-gradient px-4 text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} 发送
          </button>
        </div>
      </div>
    </div>
  );
}
