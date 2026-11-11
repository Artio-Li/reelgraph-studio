import { pendingJobs, updateJob, addCredits, getJob, db, createJob, priceOf } from './db.js';
import { getVideo, getImageTask, downloadMedia, createVideo, MuseError } from './muse.js';

const TICK_MS = 3000;
const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;   // 15 分钟
const IMAGE_TIMEOUT_MS = 8 * 60 * 1000;

const inflight = new Set();

function failJob(job, message) {
  updateJob(job.id, { status: 'failed', error: String(message).slice(0, 500), finished_at: Date.now() });
  if (!job.refunded && job.cost > 0) {
    try {
      addCredits(job.userId, job.cost, '任务失败退还', job.id);
      updateJob(job.id, { refunded: 1 });
      job.refunded = true;
    } catch (e) {
      console.error('[worker] 退款失败', job.id, e.message);
    }
  }
}

function settleDone(job, payload) {
  // 上游三种形态都兼容：视频给 url/result.url，图片给 data[0].url，部分走 video.url
  const url = payload?.url
    || payload?.result?.url
    || payload?.video?.url
    || payload?.data?.[0]?.url
    || null;
  if (!url) return failJob(job, '上游未返回媒体地址');
  const kind = job.type === 'video' ? 'video' : 'image';
  const account = payload.account || null;

  downloadMedia(url, job.id, kind)
    .then(({ fileName, bytes }) => {
      updateJob(job.id, {
        status: 'completed',
        progress: 100,
        media_file: fileName,
        account_id: account,
        result: JSON.stringify({ ...(payload.result || {}), url, localUrl: `/media/${fileName}`, bytes }),
        error: null,
        finished_at: Date.now(),
      });
      console.log(`[worker] 完成 ${job.id} → ${fileName} (${bytes}B)`);
    })
    .catch((err) => {
      // 媒体落地失败也要让用户拿到结果：退回上游直链
      console.warn('[worker] 媒体下载失败，改用直链', job.id, err.message);
      updateJob(job.id, {
        status: 'completed',
        progress: 100,
        media_file: null,
        account_id: account,
        result: JSON.stringify({ ...(payload.result || {}), url, remote: true }),
        error: null,
        finished_at: Date.now(),
      });
    });
}

async function pollOne(job) {
  if (inflight.has(job.id)) return;
  inflight.add(job.id);
  try {
    const limit = job.type === 'video' ? VIDEO_TIMEOUT_MS : IMAGE_TIMEOUT_MS;
    if (Date.now() - job.createdAt > limit) {
      return failJob(job, '任务超时，请重试');
    }

    const data = job.type === 'video'
      ? await getVideo(job.upstreamId)
      : await getImageTask(job.upstreamId);

    const status = String(data.status || '').toLowerCase();
    const progress = Number(data.progress) || job.progress || 0;

    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      settleDone(job, data);
    } else if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      failJob(job, data.error || '上游生成失败');
    } else {
      updateJob(job.id, {
        status: status === 'processing' ? 'processing' : (job.status === 'processing' ? 'processing' : 'queued'),
        progress: Math.max(progress, job.progress),
        account_id: data.account || job.accountId || null,
      });
    }
  } catch (err) {
    const msg = err instanceof MuseError ? err.message : err.message;
    // 429/5xx 视为临时错误，继续重试；4xx 明确失败
    if (err?.status && err.status >= 400 && err.status < 500) {
      failJob(job, msg);
    } else {
      console.warn('[worker] 轮询异常（下轮重试）', job.id, msg);
      updateJob(job.id, { status: 'processing' });
    }
  } finally {
    inflight.delete(job.id);
  }
}

/* ------------------------- 任务队列：自动执行 ------------------------- */
const QUEUE_TICK_MS = 20_000;

async function tickQueue() {
  // 1) 到期的 pending 项 → 创建任务
  const due = db.prepare(
    "SELECT * FROM queue_items WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY sort_order ASC LIMIT 3"
  ).all(Date.now());

  for (const q of due) {
    let params = {};
    try { params = JSON.parse(q.params || '{}'); } catch { params = {}; }

    const cost = priceOf('video', params);
    const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(q.user_id);
    if (!u || u.credits < cost) {
      db.prepare("UPDATE queue_items SET status = 'paused', note = ? WHERE id = ?")
        .run(`积分不足（需 ${cost}），任务已暂停`, q.id);
      continue;
    }

    const job = createJob(q.user_id, 'video', q.prompt, params, cost);
    addCredits(q.user_id, -cost, '队列任务执行', job.id);

    try {
      const payload = {
        prompt: q.prompt,
        model: 'muse-video',
        duration: Number(params.duration) || 5,
        size: params.size || '16:9',
      };
      const out = await createVideo(payload);
      const upstreamId = out?.id || out?.task_id;
      if (!upstreamId) throw new Error('上游未返回任务 ID');

      updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 15 });
      db.prepare("UPDATE queue_items SET status = 'running', job_id = ?, runs = runs + 1, last_run_at = ? WHERE id = ?")
        .run(job.id, Date.now(), q.id);
      console.log(`[queue] 执行 ${q.id} → job ${job.id}`);
    } catch (e) {
      updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
      addCredits(q.user_id, cost, '队列任务失败退还', job.id);
      updateJob(job.id, { refunded: 1 });
      db.prepare("UPDATE queue_items SET status = 'failed', note = ?, runs = runs + 1 WHERE id = ?")
        .run(String(e.message).slice(0, 200), q.id);
    }
  }

  // 2) 执行中的项 → 依据任务结果安排下一轮
  const running = db.prepare("SELECT * FROM queue_items WHERE status = 'running' AND job_id IS NOT NULL").all();
  for (const q of running) {
    const job = getJob(q.job_id);
    if (!job) continue;
    if (!['completed', 'failed'].includes(job.status)) continue;

    const finished = job.status === 'completed';
    if (q.runs >= q.max_runs) {
      db.prepare("UPDATE queue_items SET status = ? , note = ? WHERE id = ?")
        .run(finished ? 'done' : 'failed', finished ? '全部执行完成' : (job.error || '执行失败'), q.id);
    } else {
      const next = Date.now() + q.interval_min * 60_000;
      db.prepare("UPDATE queue_items SET status = 'pending', next_run_at = ?, note = ? WHERE id = ?")
        .run(next, finished ? '已执行，等待下次' : `本次失败：${String(job.error || '').slice(0, 60)}`, q.id);
    }
  }
}

export function startWorker() {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const jobs = pendingJobs();
      if (jobs.length) await Promise.all(jobs.map(pollOne));
    } catch (e) {
      console.error('[worker] tick 异常', e.message);
    } finally {
      running = false;
    }
  }, TICK_MS);

  setInterval(() => {
    tickQueue().catch((e) => console.error('[queue] tick 异常', e.message));
  }, QUEUE_TICK_MS);

  console.log('[worker] 任务轮询已启动，队列调度每 ' + QUEUE_TICK_MS / 1000 + 's 检查一次');
}

export { pollOne };
