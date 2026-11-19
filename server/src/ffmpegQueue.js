import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.FFMPEG_CONCURRENCY) || 1));
let active = 0;
const queue = [];

/**
 * 串行/限流执行重型媒体子进程，防止在 2C2G 小规格云主机上多个 FFmpeg
 * 同时重编码把 CPU 打满导致主进程或无头 Chromium 卡顿超时。
 */
export function withFfmpegSlot(task) {
  return new Promise((resolve, reject) => {
    const step = () => {
      active += 1;
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENCY) step();
    else queue.push(step);
  });
}

export async function runMediaBinary(binary, args = [], options = {}) {
  const finalArgs = binary === 'ffmpeg' && !args.includes('-threads')
    ? ['-threads', '2', ...args]
    : args;
  return withFfmpegSlot(async () => {
    try {
      return await execFileAsync(binary, finalArgs, { maxBuffer: 32 * 1024 * 1024, ...options });
    } catch (error) {
      const detail = String(error?.stderr || error?.message || '').trim().slice(0, 800);
      throw new Error(`${binary} 处理失败${detail ? `：${detail}` : ''}`);
    }
  });
}

/** 定期清理临时目录中超过 maxAgeMs 的遗留临时切片与抽帧文件 */
export function sweepTempDir(tmpDir, maxAgeMs = 6 * 60 * 60 * 1000) {
  try {
    if (!tmpDir || !fs.existsSync(tmpDir)) return 0;
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
      const target = path.join(tmpDir, entry.name);
      try {
        const stat = fs.statSync(target);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(target, { recursive: true, force: true });
          removed += 1;
        }
      } catch { /* ignore concurrent unlink */ }
    }
    return removed;
  } catch {
    return 0;
  }
}
