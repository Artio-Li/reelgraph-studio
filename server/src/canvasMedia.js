import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CFG } from './config.js';

const execFileAsync = promisify(execFile);
const TMP_DIR = path.join(CFG.dataDir, 'tmp');

export const CONTINUATION_INSTRUCTION = `【续集连续性硬性要求】
这是上一段视频的直接续集。系统同时提供了上一段完整视频【视频1】和上一段最后一帧【图1】；必须优先以它们为连续性基准。
1. 人物身份、脸部五官、发型发色、服装款式与颜色、配饰、身材比例保持完全一致。
2. 场景空间、道具位置、时间、天气、光线方向、色温、曝光和整体色调保持连续。
3. 镜头机位、焦段、构图、运动方向、人物朝向和动作惯性从上一段最后一帧自然承接。
4. 本段只能生成时间线上紧接着发生的后续内容，不得重演、复述或重复上一段已经发生的动作和镜头。
5. 开头第一帧应与【图1】视觉连续，再自然发展到本段提示词描述的新动作；禁止跳切、瞬移、换脸、换装或重置场景。`;

async function run(binary, args, options = {}) {
  try {
    return await execFileAsync(binary, args, { maxBuffer: 8 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim().slice(0, 800);
    throw new Error(`${binary} 处理失败${detail ? `：${detail}` : ''}`);
  }
}

function videoMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

export async function continuationReferences(videoFile) {
  if (!videoFile || !fs.existsSync(videoFile)) throw new Error('上一段视频文件不存在，无法生成续集');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const frameFile = path.join(TMP_DIR, `continuation-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-sseof', '-0.12', '-i', videoFile,
      '-frames:v', '1', '-q:v', '2', '-y', frameFile,
    ]);
    const frame = fs.readFileSync(frameFile).toString('base64');
    const video = fs.readFileSync(videoFile).toString('base64');
    return {
      lastFrame: { url: `data:image/jpeg;base64,${frame}` },
      video: { url: `data:${videoMime(videoFile)};base64,${video}` },
    };
  } finally {
    try { fs.unlinkSync(frameFile); } catch { /* temporary file may not exist */ }
  }
}

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file,
  ]);
  const info = JSON.parse(stdout || '{}');
  const video = (info.streams || []).find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video?.height) throw new Error(`无法读取视频尺寸：${path.basename(file)}`);
  return {
    width: Number(video.width),
    height: Number(video.height),
    hasAudio: (info.streams || []).some((stream) => stream.codec_type === 'audio'),
    duration: Number(info.format?.duration || video.duration || 0),
  };
}

export async function mergeVideoClips(files, outputFile) {
  if (!Array.isArray(files) || !files.length) throw new Error('分镜板还没有可导出的视频');
  for (const file of files) {
    if (!file || !fs.existsSync(file)) throw new Error(`分镜视频文件不存在：${path.basename(file || '')}`);
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(TMP_DIR, 'storyboard-'));
  try {
    const first = await probe(files[0]);
    const width = Math.max(2, Math.floor(first.width / 2) * 2);
    const height = Math.max(2, Math.floor(first.height / 2) * 2);
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p`;
    const normalized = [];
    for (let index = 0; index < files.length; index += 1) {
      const source = files[index];
      const meta = await probe(source);
      const target = path.join(workDir, `clip-${String(index).padStart(3, '0')}.mp4`);
      const args = ['-hide_banner', '-loglevel', 'error', '-i', source];
      if (!meta.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      args.push(
        '-map', '0:v:0', '-map', meta.hasAudio ? '0:a:0' : '1:a:0',
        '-vf', filter,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '1',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
        '-shortest', '-movflags', '+faststart', '-y', target,
      );
      await run('ffmpeg', args);
      normalized.push(target);
    }
    const listFile = path.join(workDir, 'clips.txt');
    fs.writeFileSync(listFile, normalized.map((file) => `file '${path.basename(file)}'`).join('\n'));
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy', '-movflags', '+faststart', '-y', outputFile,
    ], { cwd: workDir });
    return {
      bytes: fs.statSync(outputFile).size,
      width,
      height,
      duration: normalized.length ? undefined : 0,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
