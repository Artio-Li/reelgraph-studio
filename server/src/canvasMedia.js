import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { runMediaBinary } from './ffmpegQueue.js';

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
  return runMediaBinary(binary, args, options);
}

function videoMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

/**
 * 为落盘视频生成轻量 WebP 首帧缩略图，供前端卡片懒加载展示（失败不阻断主流程）。
 */
export async function extractVideoPoster(videoFile, posterFile) {
  try {
    if (!videoFile || !fs.existsSync(videoFile)) return null;
    const out = posterFile || videoFile.replace(/\.[^.]+$/, '.poster.webp');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-ss', '0.15', '-i', videoFile,
      '-frames:v', '1',
      '-vf', 'scale=640:-2:force_original_aspect_ratio=decrease',
      '-c:v', 'libwebp', '-q:v', '78',
      '-y', out,
    ]);
    return fs.existsSync(out) ? out : null;
  } catch {
    return null;
  }
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

export async function probeVideo(file) {
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

export async function probeAudioDuration(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ]);
    return Math.max(0, Number(String(stdout || '').trim()) || 0);
  } catch {
    return 0;
  }
}

function targetDimensions(preset, first) {
  const dimensions = {
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '1:1': [1080, 1080],
  }[preset];
  if (dimensions) return dimensions;
  return [Math.max(2, Math.floor(first.width / 2) * 2), Math.max(2, Math.floor(first.height / 2) * 2)];
}

function normalizedClip(value) {
  if (typeof value === 'string') return { file: value };
  return value || {};
}

function formatAssTime(sec) {
  const total = Math.max(0, Number(sec) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.min(99, Math.round((total - Math.floor(total)) * 100));
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function wrapSubtitleLine(text, maxChars = 16) {
  const clean = String(text || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\r?\n+/g, ' ')
    .trim();
  if (!clean) return '';
  if (clean.length <= maxChars) return clean;
  const parts = clean.split(/([，。！？；、,.!?;]+)/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const token of parts) {
    if ((cur + token).length <= maxChars + 2) {
      cur += token;
    } else {
      if (cur) lines.push(cur);
      cur = token;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 1 && clean.length > maxChars) {
    const chunks = [];
    for (let i = 0; i < clean.length; i += maxChars) chunks.push(clean.slice(i, i + maxChars));
    return chunks.join('\\N');
  }
  return lines.join('\\N');
}

function buildAssScript(entries, width, height) {
  const portrait = height > width;
  const fontSize = portrait ? Math.round(width * 0.048) : Math.round(height * 0.052);
  const marginV = portrait ? Math.round(height * 0.095) : Math.round(height * 0.065);
  const maxChars = portrait ? 14 : 22;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,WenQuanYi Zen Hei,${fontSize},&H00FFFFFF,&H000000FF,&H28080C14,&H80000000,1,0,0,0,100,100,0.8,0,1,2.6,1.2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = entries
    .filter((item) => item.text && item.end > item.start + 0.15)
    .map((item) => `Dialogue: 0,${formatAssTime(item.start)},${formatAssTime(item.end)},Default,,0,0,0,,${wrapSubtitleLine(item.text, maxChars)}`);

  return lines.length ? `${header}\n${lines.join('\n')}\n` : null;
}

export async function mergeVideoClips(inputClips, outputFile, options = {}) {
  if (!Array.isArray(inputClips) || !inputClips.length) throw new Error('分镜板还没有可导出的视频');
  const clips = inputClips.map(normalizedClip);
  for (const clip of clips) {
    if (!clip.file || !fs.existsSync(clip.file)) throw new Error(`分镜视频文件不存在：${path.basename(clip.file || '')}`);
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(TMP_DIR, 'storyboard-'));
  try {
    const first = await probeVideo(clips[0].file);
    const [width, height] = targetDimensions(options.outputSize, first);
    const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p`;
    const normalized = [];
    let anyNarration = false;

    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const source = clip.file;
      const meta = await probeVideo(source);
      const trimStart = Math.max(0, Math.min(Number(clip.trimStart) || 0, Math.max(0, meta.duration - 0.1)));
      const trimEnd = Math.max(0, Number(clip.trimEnd) || 0);
      const duration = Math.max(0.1, meta.duration - trimStart - Math.min(trimEnd, Math.max(0, meta.duration - trimStart - 0.1)));
      const baseVolume = Math.max(0, Math.min(2, Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 1));
      const hasNarration = Boolean(clip.narrationFile && fs.existsSync(clip.narrationFile));
      if (hasNarration) anyNarration = true;

      const target = path.join(workDir, `clip-${String(index).padStart(3, '0')}.mp4`);
      const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(trimStart), '-t', String(duration), '-i', source];
      if (!meta.hasAudio) {
        args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      }
      if (hasNarration) {
        const narrationIdx = meta.hasAudio ? 1 : 2;
        const origAudioIdx = meta.hasAudio ? 0 : 1;
        const ambientVol = Math.min(baseVolume, 0.25);
        args.push(
          '-i', clip.narrationFile,
          '-filter_complex',
          `[0:v]${filter}[vout];[${origAudioIdx}:a]volume=${ambientVol},apad=whole_dur=${duration}[amb];[${narrationIdx}:a]volume=1.15,apad=whole_dur=${duration}[voc];[amb][voc]amix=inputs=2:duration=first:dropout_transition=0.2,atrim=0:${duration}[aout]`,
          '-map', '[vout]', '-map', '[aout]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '1',
          '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
          '-t', String(duration), '-movflags', '+faststart', '-y', target,
        );
      } else {
        args.push(
          '-map', '0:v:0', '-map', meta.hasAudio ? '0:a:0' : '1:a:0',
          '-vf', filter,
          '-af', `volume=${baseVolume}`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '1',
          '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
          '-shortest', '-movflags', '+faststart', '-y', target,
        );
      }
      await run('ffmpeg', args);
      normalized.push({
        file: target,
        duration,
        subtitleText: String(clip.subtitleText || clip.narration || '').trim(),
        transition: clip.transition === 'fade' ? 'fade' : 'cut',
        transitionDuration: Math.max(0.1, Math.min(1.5, Number(clip.transitionDuration) || 0.35)),
      });
    }

    // 计算时间轴偏移（供字幕精确对齐）
    const subtitleEntries = [];
    let cursor = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      const clip = normalized[i];
      const fadeOverlap = i > 0 && clip.transition === 'fade'
        ? Math.min(clip.transitionDuration, cursor / 2, clip.duration / 2)
        : 0;
      const start = Math.max(0, cursor - fadeOverlap);
      const end = start + clip.duration;
      if (clip.subtitleText && options.burnSubtitles !== false) {
        subtitleEntries.push({
          start: start + 0.12,
          end: Math.max(start + 0.4, end - 0.15),
          text: clip.subtitleText,
        });
      }
      cursor = end;
    }

    const needSubtitles = subtitleEntries.length > 0 && options.burnSubtitles !== false;
    const needBgm = Boolean(options.bgmFile);
    const stage1Out = (needSubtitles || needBgm) ? path.join(workDir, 'stage1-joined.mp4') : outputFile;

    const hasFade = normalized.slice(1).some((clip) => clip.transition === 'fade');
    if (normalized.length === 1) {
      fs.copyFileSync(normalized[0].file, stage1Out);
    } else if (!hasFade) {
      const listFile = path.join(workDir, 'clips.txt');
      fs.writeFileSync(listFile, normalized.map((clip) => `file '${path.basename(clip.file)}'`).join('\n'));
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-c', 'copy', '-movflags', '+faststart', '-y', stage1Out,
      ], { cwd: workDir });
    } else {
      const args = ['-hide_banner', '-loglevel', 'error'];
      normalized.forEach((clip) => args.push('-i', clip.file));
      const filters = [];
      let videoLabel = '0:v';
      let audioLabel = '0:a';
      let timeline = normalized[0].duration;
      for (let index = 1; index < normalized.length; index += 1) {
        const clip = normalized[index];
        const fade = clip.transition === 'fade'
          ? Math.min(clip.transitionDuration, timeline / 2, clip.duration / 2)
          : 0.001;
        const nextVideo = `v${index}`;
        const nextAudio = `a${index}`;
        filters.push(`[${videoLabel}][${index}:v]xfade=transition=fade:duration=${fade}:offset=${Math.max(0, timeline - fade)}[${nextVideo}]`);
        filters.push(`[${audioLabel}][${index}:a]acrossfade=d=${fade}:c1=tri:c2=tri[${nextAudio}]`);
        videoLabel = nextVideo;
        audioLabel = nextAudio;
        timeline += clip.duration - fade;
      }
      args.push(
        '-filter_complex', filters.join(';'), '-map', `[${videoLabel}]`, '-map', `[${audioLabel}]`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '1',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k',
        '-movflags', '+faststart', '-y', stage1Out,
      );
      await run('ffmpeg', args);
    }

    let currentVideo = stage1Out;
    if (needSubtitles) {
      const assContent = buildAssScript(subtitleEntries, width, height);
      if (assContent) {
        const assFile = path.join(workDir, 'subs.ass');
        const subOut = needBgm ? path.join(workDir, 'stage2-subbed.mp4') : outputFile;
        fs.writeFileSync(assFile, assContent, 'utf8');
        try {
          await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error',
            '-i', path.basename(currentVideo),
            '-vf', 'ass=subs.ass',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '1',
            '-c:a', 'copy', '-movflags', '+faststart', '-y', subOut,
          ], { cwd: workDir });
          currentVideo = subOut;
        } catch (subErr) {
          console.warn('[canvasMedia] 字幕滤镜不可用，回退无烧录成片:', subErr.message);
          if (!needBgm) fs.copyFileSync(currentVideo, outputFile);
        }
      } else if (!needBgm) {
        fs.copyFileSync(currentVideo, outputFile);
      }
    }

    if (needBgm) {
      if (!fs.existsSync(options.bgmFile)) throw new Error('分镜板背景音乐文件不存在');
      const bgmVolume = Math.max(0, Math.min(2, Number(options.bgmVolume) || 0.25));
      const useDucking = options.duckBgm !== false && anyNarration;
      if (useDucking) {
        try {
          await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-i', currentVideo, '-stream_loop', '-1', '-i', options.bgmFile,
            '-filter_complex',
            `[0:a]asplit=2[voice][sc];[1:a]volume=${bgmVolume}[bgm];[bgm][sc]sidechaincompress=threshold=0.025:ratio=6:attack=35:release=350[bgmduck];[voice][bgmduck]amix=inputs=2:duration=first:dropout_transition=2[a]`,
            '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
            '-shortest', '-movflags', '+faststart', '-y', outputFile,
          ]);
        } catch {
          await run('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-i', currentVideo, '-stream_loop', '-1', '-i', options.bgmFile,
            '-filter_complex', `[0:a]volume=1[a0];[1:a]volume=${Math.max(0.08, bgmVolume * 0.55)}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
            '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
            '-shortest', '-movflags', '+faststart', '-y', outputFile,
          ]);
        }
      } else {
        await run('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-i', currentVideo, '-stream_loop', '-1', '-i', options.bgmFile,
          '-filter_complex', `[0:a]volume=1[a0];[1:a]volume=${bgmVolume}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]`,
          '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2',
          '-shortest', '-movflags', '+faststart', '-y', outputFile,
        ]);
      }
    }

    await extractVideoPoster(outputFile);
    const finalMeta = await probeVideo(outputFile);
    return {
      bytes: fs.statSync(outputFile).size,
      width,
      height,
      duration: finalMeta.duration,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
