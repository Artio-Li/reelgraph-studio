import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { probeVideo } from './canvasMedia.js';

const execFileAsync = promisify(execFile);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function ffmpeg(args, options = {}) {
  try {
    return await execFileAsync('ffmpeg', args, { maxBuffer: 32 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim().slice(0, 800);
    throw new Error(`视频质检失败${detail ? `：${detail}` : ''}`);
  }
}

function frameStatistics(bytes, width, height) {
  const frameSize = width * height;
  const frameCount = Math.floor(bytes.length / frameSize);
  if (!frameCount) return null;
  let totalMean = 0;
  let totalContrast = 0;
  let totalEdges = 0;
  let totalMotion = 0;
  let darkFrames = 0;
  let brightFrames = 0;
  let previous = null;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frame = bytes.subarray(frameIndex * frameSize, (frameIndex + 1) * frameSize);
    let sum = 0;
    let square = 0;
    let edges = 0;
    let motion = 0;
    for (let index = 0; index < frame.length; index += 1) {
      const value = frame[index];
      sum += value;
      square += value * value;
      if (index % width) edges += Math.abs(value - frame[index - 1]);
      if (index >= width) edges += Math.abs(value - frame[index - width]);
      if (previous) motion += Math.abs(value - previous[index]);
    }
    const mean = sum / frame.length;
    const contrast = Math.sqrt(Math.max(0, square / frame.length - mean * mean));
    totalMean += mean;
    totalContrast += contrast;
    totalEdges += edges / Math.max(1, frame.length * 2 - width - height);
    if (previous) totalMotion += motion / frame.length;
    if (mean < 22) darkFrames += 1;
    if (mean > 235) brightFrames += 1;
    previous = frame;
  }
  return {
    frameCount,
    meanLuma: round(totalMean / frameCount),
    contrast: round(totalContrast / frameCount),
    edgeEnergy: round(totalEdges / frameCount, 2),
    motion: round(totalMotion / Math.max(1, frameCount - 1), 2),
    darkRatio: round(darkFrames / frameCount, 2),
    brightRatio: round(brightFrames / frameCount, 2),
  };
}

function detectedDuration(log, pattern) {
  let total = 0;
  for (const match of String(log || '').matchAll(pattern)) total += Number(match[1]) || 0;
  return total;
}

export async function analyzeVideoQuality(file, { expectedDuration = 0, threshold = 75 } = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`质检视频不存在：${path.basename(file || '')}`);
  const meta = await probeVideo(file);
  const sampleWidth = 160;
  const sampleHeight = Math.max(2, Math.round((sampleWidth * meta.height / meta.width) / 2) * 2);
  const [{ stdout }, detection] = await Promise.all([
    ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `fps=2,scale=${sampleWidth}:${sampleHeight}:flags=fast_bilinear,format=gray`,
      '-an', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ], { encoding: null }),
    ffmpeg([
      '-hide_banner', '-loglevel', 'info', '-i', file,
      '-vf', 'blackdetect=d=0.35:pic_th=0.98,freezedetect=n=-50dB:d=0.8',
      '-an', '-f', 'null', '-',
    ]),
  ]);
  const stats = frameStatistics(Buffer.from(stdout), sampleWidth, sampleHeight) || {};
  const blackSeconds = detectedDuration(detection.stderr, /black_duration:([\d.]+)/g);
  const freezeSeconds = detectedDuration(detection.stderr, /freeze_duration:([\d.]+)/g);
  const issues = [];
  let score = 100;
  if (expectedDuration && meta.duration < expectedDuration * 0.8) {
    score -= 25;
    issues.push(`视频时长 ${round(meta.duration)} 秒，短于预期`);
  }
  if (Math.min(meta.width, meta.height) < 480) {
    score -= 10;
    issues.push('输出分辨率偏低');
  }
  if (stats.darkRatio > 0.45 || blackSeconds > meta.duration * 0.2) {
    score -= 20;
    issues.push('大面积黑场或整体过暗');
  }
  if (stats.brightRatio > 0.45) {
    score -= 15;
    issues.push('大面积过曝');
  }
  if (stats.contrast < 10) {
    score -= 12;
    issues.push('画面对比度过低');
  }
  if (stats.edgeEnergy < 3.2) {
    score -= 15;
    issues.push('画面疑似持续模糊');
  }
  if (meta.duration > 2 && (stats.motion < 0.9 || freezeSeconds > meta.duration * 0.35)) {
    score -= 20;
    issues.push('疑似长时间静帧或动作停滞');
  }
  score = clamp(Math.round(score), 0, 100);
  return {
    score,
    passed: score >= threshold,
    threshold,
    issues,
    technical: {
      duration: round(meta.duration, 2), width: meta.width, height: meta.height,
      hasAudio: meta.hasAudio, blackSeconds: round(blackSeconds, 2), freezeSeconds: round(freezeSeconds, 2),
      ...stats,
    },
    checkedAt: Date.now(),
  };
}

export async function extractIdentityFrames(file, count = 5) {
  const meta = await probeVideo(file);
  const ratios = count <= 1 ? [0.5] : Array.from({ length: count }, (_, index) => 0.08 + (0.84 * index / (count - 1)));
  const frames = [];
  for (const ratio of ratios) {
    const time = Math.max(0, Math.min(meta.duration - 0.05, meta.duration * ratio));
    const { stdout } = await ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
      '-frames:v', '1', '-vf', 'scale=512:-2:force_original_aspect_ratio=decrease',
      '-q:v', '3', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1',
    ], { encoding: null });
    frames.push({ url: `data:image/jpeg;base64,${Buffer.from(stdout).toString('base64')}` });
  }
  return frames;
}
