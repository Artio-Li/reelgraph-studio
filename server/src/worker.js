import fs from 'node:fs';
import path from 'node:path';
import { CFG, MEDIA_DIR } from './config.js';
import { pendingJobs, updateJob, addCredits, getJob, db, createJob, priceOf } from './db.js';
import { getImageTask, downloadMedia, MuseError } from './muse.js';
import { applyRealism, realismEnabled } from './realism.js';
import { repairVideoPrompt } from './canvasAI.js';
import { extractVideoPoster } from './canvasMedia.js';
import { sweepTempDir } from './ffmpegQueue.js';
import { extractRefusalFeedback, pollVideoTask, sanitizeVideoPrompt, submitVideoTask } from './videoProvider.js';

const TICK_MS = 3000;
const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;   // 15 分钟
const IMAGE_TIMEOUT_MS = 8 * 60 * 1000;
const TMP_SWEEP_MS = 60 * 60 * 1000;

const inflight = new Set();

function normalizeStoredRefs(images) {
  if (!Array.isArray(images)) return [];
  const uploadDir = path.join(CFG.dataDir, 'uploads');
  const mimes = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  };
  const out = [];
  for (const item of images) {
    if (!item) continue;
    if (typeof item === 'string') {
      if (item.startsWith('/uploads/') || item.startsWith('/media/')) {
        const root = item.startsWith('/media/') ? MEDIA_DIR : uploadDir;
        const file = path.join(root, path.basename(item));
        if (fs.existsSync(file)) {
          const mime = mimes[path.extname(file).toLowerCase()] || 'image/png';
          out.push({ url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` });
        }
      } else if (/^(https?:|data:)/i.test(item)) {
        out.push({ url: item });
      }
    } else if (item.url) {
      out.push(item);
    }
  }
  return out;
}

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

/**
 * 针对 Muse 上游“仅返回文本反问 / 拒答”进行单次自动改词自愈重投（不重复扣费）。
 */
async function tryAutoHealRefusal(job, rawError) {
  if (job.type !== 'video') return false;
  if (job.params?.__refusalRetried) return false;
  // 续集节点包含复杂视频引用，交由画布层处理，这里只对普通/首帧视频任务自愈
  if (job.params?.continuationFrom) return false;
  const feedback = extractRefusalFeedback(rawError);
  if (!feedback) return false;

  try {
    const repaired = await repairVideoPrompt({
      prompt: job.prompt,
      feedback: `上游模型拒绝生成视频并仅返回文本：“${feedback}”`,
      duration: Number(job.params?.duration) || 5,
      size: job.params?.size || '16:9',
      provider: job.params?.provider || undefined,
    });
    if (!repaired?.prompt) return false;

    const cleanPrompt = sanitizeVideoPrompt(repaired.prompt);
    const refs = normalizeStoredRefs(job.params?.images || []);
    const payload = {
      prompt: applyRealism(cleanPrompt, 'video'),
      model: job.params?.model || 'muse-video',
      duration: Number(job.params?.duration) || 5,
      size: job.params?.size || '16:9',
      ...(refs.length ? { images: refs } : {}),
    };
    const out = await submitVideoTask(payload);
    const nextUpstreamId = out?.id || out?.task_id;
    if (!nextUpstreamId) return false;

    updateJob(job.id, {
      prompt: cleanPrompt,
      upstream_id: nextUpstreamId,
      status: 'processing',
      progress: 18,
      error: null,
      params: {
        ...(job.params || {}),
        __refusalRetried: true,
        __originalPrompt: job.prompt,
        __refusalFeedback: feedback.slice(0, 240),
      },
    });
    console.log(`[worker] 检测到上游纯文本反问，已自动修复提示词并重投 ${job.id} (${repaired.provider})`);
    return true;
  } catch (err) {
    console.warn('[worker] 反问自动修复失败，回退常规失败流程:', job.id, err.message);
    return false;
  }
}

function settleDone(job, payload) {
  const url = payload?.url
    || payload?.result?.url
    || payload?.video?.url
    || payload?.data?.[0]?.url
    || null;
  if (!url) return failJob(job, '上游未返回媒体地址');
  const kind = job.type === 'video' ? 'video' : 'image';
  const account = payload.account || null;

  downloadMedia(url, job.id, kind)
    .then(async ({ fileName, bytes }) => {
      let posterUrl = null;
      if (kind === 'video') {
        const videoPath = path.join(MEDIA_DIR, fileName);
        const posterFile = await extractVideoPoster(videoPath);
        if (posterFile) posterUrl = `/media/${path.basename(posterFile)}`;
      }
      updateJob(job.id, {
        status: 'completed',
        progress: 100,
        media_file: fileName,
        account_id: account,
        result: JSON.stringify({
          ...(payload.result || {}),
          url,
          localUrl: `/media/${fileName}`,
          ...(posterUrl ? { posterUrl } : {}),
          bytes,
        }),
        error: null,
        finished_at: Date.now(),
      });
      console.log(`[worker] 完成 ${job.id} → ${fileName} (${bytes}B)`);
    })
    .catch((err) => {
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
      ? await pollVideoTask(job.upstreamId, job.params?.videoProvider || 'muse')
      : await getImageTask(job.upstreamId);

    const status = String(data.status || '').toLowerCase();
    const progress = Number(data.progress) || job.progress || 0;

    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      settleDone(job, data);
    } else if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      const healed = await tryAutoHealRefusal(job, data.error || '');
      if (!healed) failJob(job, data.error || '上游生成失败');
    } else {
      updateJob(job.id, {
        status: status === 'processing' ? 'processing' : (job.status === 'processing' ? 'processing' : 'queued'),
        progress: Math.max(progress, job.progress),
        account_id: data.account || job.accountId || null,
      });
    }
  } catch (err) {
    const msg = err instanceof MuseError ? err.message : err.message;
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

/* ------------------------- 启动时孤儿任务自愈 ------------------------- */
export function recoverOrphanTasks() {
  try {
    const cutoff = Date.now() - 2 * 60 * 1000;
    // 1) 重启前处于同步生图/提交中但未拿到 upstream_id 的孤儿 jobs
    const stuckJobs = db.prepare(
      "SELECT * FROM jobs WHERE status IN ('queued','processing') AND upstream_id IS NULL AND updated_at < ?"
    ).all(cutoff);
    for (const row of stuckJobs) {
      const job = getJob(row.id);
      // 若属于 waiting 的画布下游节点，保留由画布调度器推进；否则若卡在 processing 则失败退款
      const nr = db.prepare("SELECT * FROM node_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1").get(row.id);
      if (nr && ['queued', 'waiting'].includes(nr.status)) continue;
      if (job) failJob(job, '服务重启中断，积分已自动退还');
    }
    // 2) 重启前卡在 processing 的同步画布节点（geminiPrompt / geminiImage）重置回 queued 重跑
    const resetNodes = db.prepare(
      "UPDATE node_runs SET status = 'queued', updated_at = ? WHERE status = 'processing' AND node_type IN ('geminiPrompt','geminiImage') AND updated_at < ?"
    ).run(Date.now(), cutoff);
    if (stuckJobs.length || resetNodes.changes) {
      console.log(`[worker] 启动恢复：处理孤儿任务 ${stuckJobs.length} 条，重置同步节点 ${resetNodes.changes} 个`);
    }
  } catch (err) {
    console.warn('[worker] 孤儿任务恢复跳过:', err.message);
  }
}

/* ------------------------- 任务队列：自动执行 ------------------------- */
const QUEUE_TICK_MS = 20_000;

async function tickQueue() {
  const due = db.prepare(
    "SELECT * FROM queue_items WHERE status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY sort_order ASC LIMIT 3"
  ).all(Date.now());

  for (const q of due) {
    let params = {};
    try { params = JSON.parse(q.params || '{}'); } catch { params = {}; }
    const effectiveParams = { ...params, realism: realismEnabled() };

    const cost = priceOf('video', effectiveParams);
    const u = db.prepare('SELECT credits FROM users WHERE id = ?').get(q.user_id);
    if (!u || u.credits < cost) {
      db.prepare("UPDATE queue_items SET status = 'paused', note = ? WHERE id = ?")
        .run(`积分不足（需 ${cost}），任务已暂停`, q.id);
      continue;
    }

    const job = createJob(q.user_id, 'video', q.prompt, effectiveParams, cost);
    addCredits(q.user_id, -cost, '队列任务执行', job.id);

    try {
      const payload = {
        prompt: applyRealism(sanitizeVideoPrompt(q.prompt), 'video'),
        model: 'muse-video',
        duration: Number(params.duration) || 5,
        size: params.size || '16:9',
      };
      const out = await submitVideoTask(payload);
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
  recoverOrphanTasks();
  sweepTempDir(path.join(CFG.dataDir, 'tmp'));

  let running = false;
  const pollTimer = setInterval(async () => {
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
  pollTimer.unref?.();

  const queueTimer = setInterval(() => {
    tickQueue().catch((e) => console.error('[queue] tick 异常', e.message));
  }, QUEUE_TICK_MS);
  queueTimer.unref?.();

  const sweepTimer = setInterval(() => {
    sweepTempDir(path.join(CFG.dataDir, 'tmp'));
  }, TMP_SWEEP_MS);
  sweepTimer.unref?.();

  console.log('[worker] 任务轮询已启动，队列调度每 ' + QUEUE_TICK_MS / 1000 + 's 检查一次');
}

export { pollOne };
