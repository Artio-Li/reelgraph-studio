import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CFG } from './config.js';

const execFileAsync = promisify(execFile);
const TMP_DIR = path.join(CFG.dataDir, 'tmp');

function imageRange(start, count) {
  if (!count) return '';
  return count === 1 ? `【图${start}】` : `【图${start}】至【图${start + count - 1}】`;
}

export function buildIdentityLockInstruction({ startIndex = 1, count = 0, label = '', description = '' } = {}) {
  if (!count) return '';
  const range = imageRange(startIndex, count);
  const identityName = String(label || '人物身份锚点').trim().slice(0, 80);
  const note = String(description || '').trim().slice(0, 300);
  return `【人物身份锁定｜最高优先级】
${range}是“${identityName}”的同一人物多视角身份参考，不是不同人物，也不是可自由混合的风格图。
1. 每一帧都必须保持该人物可辨认的脸型、五官比例、眼鼻口特征、肤色、年龄感、发型发色和身材比例一致。
2. 服装、配饰和整体造型以身份参考为准；不得平均脸、换脸、换人、换发型、换装或把参考图特征融合成另一个人。
3. 角度、表情、光线和动作可以随本段内容变化，但身份特征不能漂移；侧脸、遮挡和运动模糊之后也必须恢复为同一人物。
4. 身份参考只决定人物身份与造型，不得复制参考图背景，不得把多张参考图生成为多个人。${note ? `\n【身份补充说明】${note}` : ''}`;
}

export function buildContinuationInstruction({ motionFrameCount = 0 } = {}) {
  const motionRange = imageRange(2, motionFrameCount);
  return `【续集连续性硬性要求｜最高优先级】
这是上一段视频的直接续集。系统提供上一段完整视频【视频1】、精确结束帧【图1】${motionFrameCount ? `，以及结束前的运动关键帧${motionRange}` : ''}。
1. 【图1】是本段开头的视觉接点；第一帧必须与它自然连续，不能跳切、瞬移、重置构图或重新表演上一段。
2. 【视频1】用于理解人物、服装、场景、道具、光线、镜头轨迹和已经发生的动作；本段只生成时间线上紧接着发生的新内容。
${motionFrameCount ? `3. ${motionRange}只用于判断上一段末尾的运动方向、速度和惯性，不是新人物参考；动作、头发、衣料和镜头运动都要顺势延续。` : '3. 动作、头发、衣料和镜头运动必须顺着上一段末尾的方向与惯性继续。'}
4. 人物身份、五官、发型发色、服装款式与颜色、配饰和身材比例保持一致；禁止换脸、换装、增减人物。
5. 场景空间、道具位置、时间天气、光线方向、色温曝光和整体色调保持连续。
6. 镜头机位、焦段、景别、人物朝向、视线方向和运动轴线连续；除非本段提示明确要求，不得反打、越轴或突然改变运镜方向。
7. 不得复述、重演或循环上一段动作；从上一段最后状态直接发展到“本段后续内容”。`;
}

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
  const stem = `continuation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const offsets = ['-0.65', '-0.35', '-0.12'];
  const frameFiles = offsets.map((_, index) => path.join(TMP_DIR, `${stem}-${index}.jpg`));
  try {
    for (let index = 0; index < offsets.length; index += 1) {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-sseof', offsets[index], '-i', videoFile,
        '-frames:v', '1', '-q:v', '2', '-y', frameFiles[index],
      ]);
    }
    const frames = frameFiles.map((file) => ({
      url: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`,
    }));
    const video = fs.readFileSync(videoFile).toString('base64');
    return {
      lastFrame: frames[2],
      motionFrames: frames.slice(0, 2),
      video: { url: `data:${videoMime(videoFile)};base64,${video}` },
    };
  } finally {
    for (const file of frameFiles) {
      try { fs.unlinkSync(file); } catch { /* temporary file may not exist */ }
    }
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
