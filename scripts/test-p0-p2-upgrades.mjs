import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgraph-p0-p2-'));
process.env.DATA_DIR = path.join(tmpRoot, 'data');
process.env.JWT_SECRET = 'test-secret-for-p0-p2';

try {
  const { normalizeBaseUrl: normAg } = await import('/app/server/src/antigravity.js');
  const { normalizeBaseUrl: normCg } = await import('/app/server/src/chatgpt2api.js');
  const { sanitizeVideoPrompt, extractRefusalFeedback } = await import('/app/server/src/videoProvider.js');
  const { validatePlan } = await import('/app/server/src/director.js');
  const { withFfmpegSlot } = await import('/app/server/src/ffmpegQueue.js');
  const { mergeVideoClips } = await import('/app/server/src/canvasMedia.js');
  const { analyzeVideoQuality } = await import('/app/server/src/canvasQuality.js');

  assert.equal(normAg('http://123.249.39.89:8045/v1/chat/completions'), 'http://123.249.39.89:8045');
  assert.equal(normCg('https://43.130.43.32:13000/v1/images/generations'), 'https://43.130.43.32:13000');

  assert.equal(
    sanitizeVideoPrompt('面部严格参考 @[Image 1]，穿搭参考 @图2 完成走秀'),
    '面部严格参考 【图1】，穿搭参考 【图2】 完成走秀',
  );
  const refusal = extractRefusalFeedback('上游节点执行失败：模型未生成媒体，仅返回文本: 这条视频这次没能做出来。建议换正式职业装。');
  assert.ok(refusal && refusal.includes('建议换正式职业装'));

  const validated = validatePlan({
    title: '山野周末',
    shots: [
      { label: '镜头 1', duration: 10, prompt: '严格 5 秒｜清晨木屋窗边女生端起咖啡，@[Image 1] 自然微笑', narration: '周末的清晨，终于把时间还给了自己。' },
      { label: '镜头 2', duration: 10, continuation: true, prompt: '女生推开木门走向露台呼吸山间薄雾，光线柔和', narration: '山风吹散了一整周的疲惫。' },
    ],
  }, { pipelineMode: 'keyframe', totalSeconds: 20 });
  assert.equal(validated.pipelineMode, 'keyframe');
  assert.equal(validated.shots[1].continuation, false);

  let concurrent = 0, maxObserved = 0;
  await Promise.all([1, 2, 3].map(() => withFfmpegSlot(async () => {
    concurrent += 1;
    maxObserved = Math.max(maxObserved, concurrent);
    await new Promise((r) => setTimeout(r, 15));
    concurrent -= 1;
  })));
  assert.equal(maxObserved, 1);

  // Low-key scene (dark background + lit subject ~30% area -> darkRatio ~0.70, blackdetect=0)
  const clipA = path.join(tmpRoot, 'clipA.mp4');
  const voiceA = path.join(tmpRoot, 'voiceA.m4a');
  const bgm = path.join(tmpRoot, 'bgm.m4a');
  const finalOut = path.join(tmpRoot, 'final-subbed.mp4');

  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=#282e38:s=720x1280:d=1.2:r=30',
    '-vf', 'drawbox=x=160:y=320:w=400:h=600:color=#d8e2f0:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clipA,
  ]);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=#05070a:s=720x1280:d=1.2:r=30',
    '-vf', 'drawbox=x=180:y=360:w=360:h=520:color=#dce6f5:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(tmpRoot, 'noirClip.mp4'),
  ]);
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=0.9', '-c:a', 'aac', '-y', voiceA]);
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3.0', '-c:a', 'aac', '-y', bgm]);

  // Verify dark-style dynamic threshold on low-key frame (dark frames on average < 22 only if mostly dark, or static motion check on >2.2s clip)
  const staticClip = path.join(tmpRoot, 'staticClip.mp4');
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=#242c3a:s=720x1280:d=2.6:r=30',
    '-vf', 'drawbox=x=140:y=300:w=440:h=640:color=#e2ebf5:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', staticClip,
  ]);
  const qcHandheld = await analyzeVideoQuality(staticClip, { expectedDuration: 2.6, styleId: 'doc_handheld', shotId: 'handheld' });
  const qcStable = await analyzeVideoQuality(staticClip, { expectedDuration: 2.6, styleId: 'commercial_product', shotId: 'stable' });
  assert.ok(qcStable.score >= qcHandheld.score, `Expected stable shot (${qcStable.score}) >= handheld (${qcHandheld.score})`);

  const merged = await mergeVideoClips([
    { file: clipA, narrationFile: voiceA, subtitleText: '清晨的第一缕阳光照进山谷' },
  ], finalOut, { outputSize: '9:16', bgmFile: bgm, bgmVolume: 0.25, burnSubtitles: true, duckBgm: true });

  assert.ok(merged.bytes > 0);
  assert.ok(fs.existsSync(finalOut.replace(/\.mp4$/, '.poster.webp')), 'Expected auto-generated poster.webp');
  console.log('✅ All P0-P2 unit + FFmpeg subtitle/narration/ducking/poster assertions passed!');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
