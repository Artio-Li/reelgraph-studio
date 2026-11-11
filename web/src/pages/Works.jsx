import { useCallback, useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Trash2, Download, RefreshCw, Loader2, Play } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtBytes } from '../lib/api.js';
import { Badge, Button, Empty, Modal, useToast, Spinner } from '../components/ui.jsx';

const FILTERS = [
  ['', '全部', Film],
  ['video', '视频', Film],
  ['image', '图片', ImageIcon],
];

export default function Works() {
  const toast = useToast();
  const [type, setType] = useState('');
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.jobs({ type: type || undefined, page, pageSize: 24 });
      setJobs(out.jobs);
      setTotal(out.total);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [type, page, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [type]);

  const remove = async (job) => {
    if (!confirm('删除这条作品？文件会一起删掉。')) return;
    try {
      await api.deleteJob(job.id);
      setJobs((l) => l.filter((j) => j.id !== job.id));
      setTotal((t) => t - 1);
      setPreview(null);
      toast('已删除', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const pages = Math.max(1, Math.ceil(total / 24));

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 rounded-xl bg-ink-850 p-1">
          {FILTERS.map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setType(k)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                type === k ? 'bg-ink-700 text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-mist-400">共 {total} 条</span>
          <Button variant="outline" size="sm" onClick={load} loading={loading}>
            <RefreshCw size={13} /> 刷新
          </Button>
        </div>
      </div>

      {loading && !jobs.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer aspect-video rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Empty
          icon={Film}
          title="还没有作品"
          desc="去创作台生成第一条视频"
          action={<Button onClick={() => (window.location.href = '/studio')}>去创作</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {jobs.map((j) => (
            <WorkCard key={j.id} job={j} onOpen={() => setPreview(j)} onDelete={() => remove(j)} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="px-2 text-[12.5px] text-mist-400">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title="作品详情" width="max-w-3xl">
        {preview && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl bg-black/50">
              {preview.mediaUrl ? (
                /\.(mp4|webm|mov)/i.test(preview.mediaUrl) ? (
                  <video src={preview.mediaUrl} controls autoPlay loop className="max-h-[60vh] w-full" />
                ) : (
                  <img src={preview.mediaUrl} alt="" className="max-h-[60vh] w-full object-contain" />
                )
              ) : preview.result?.url ? (
                <video src={preview.result.url} controls className="max-h-[60vh] w-full" />
              ) : (
                <div className="grid h-40 place-items-center text-[13px] text-mist-400">
                  {preview.status === 'failed' ? preview.error : '暂无媒体文件'}
                </div>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-mist-200">{preview.prompt}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-500">
              <span>{preview.params?.duration || 5}s · {preview.params?.size}</span>
              <span>{preview.cost} 积分</span>
              <span>{fmtAgo(preview.createdAt)}</span>
              {preview.result?.bytes && <span>{fmtBytes(preview.result.bytes)}</span>}
            </div>
            <div className="flex gap-2 pt-1">
              {(preview.mediaUrl || preview.result?.url) && (
                <a href={preview.mediaUrl || preview.result.url} download>
                  <Button variant="soft" size="sm"><Download size={13} /> 下载</Button>
                </a>
              )}
              <Button variant="danger" size="sm" onClick={() => remove(preview)}>
                <Trash2 size={13} /> 删除
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function WorkCard({ job, onOpen, onDelete }) {
  const [hover, setHover] = useState(false);
  const running = ['queued', 'processing'].includes(job.status);
  const failed = job.status === 'failed';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative overflow-hidden rounded-xl border border-ink-700 bg-ink-850 transition hover:border-ink-500 hover:shadow-xl hover:shadow-black/40"
    >
      <button onClick={onOpen} className="block w-full">
        <div className="relative aspect-video overflow-hidden bg-ink-900">
          {job.mediaUrl ? (
            /\.(mp4|webm|mov)/i.test(job.mediaUrl) ? (
              <video
                src={job.mediaUrl}
                muted
                loop
                playsInline
                autoPlay={hover}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <img
                src={job.mediaUrl}
                alt=""
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            )
          ) : (
            <div className="grid h-full place-items-center">
              {running ? (
                <div className="flex flex-col items-center gap-2 text-[12px] text-brand-400">
                  <Loader2 size={18} className="animate-spin" />
                  {job.progress || 0}%
                </div>
              ) : failed ? (
                <span className="px-3 text-center text-[12px] text-rose-400">{job.error || '生成失败'}</span>
              ) : (
                <span className="text-[12px] text-ink-500">无预览</span>
              )}
            </div>
          )}

          <div className="absolute left-2 top-2 flex gap-1.5">
            <Badge tone={job.type === 'video' ? 'brand' : 'neutral'}>
              {job.type === 'video' ? '视频' : '图片'}
            </Badge>
            {failed && <Badge tone="error">失败</Badge>}
          </div>

          {job.mediaUrl && (
            <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
              <Play size={12} />
            </span>
          )}
        </div>
      </button>

      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-mist-300">{job.prompt}</p>
        <button
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-ink-500 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="flex items-center justify-between px-3 pb-2.5 text-[10.5px] text-ink-500">
        <span>{job.params?.duration}s · {job.params?.size}</span>
        <span>{fmtAgo(job.createdAt)}</span>
      </div>
    </div>
  );
}
