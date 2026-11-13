import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgraph-canvas-media-'));
process.env.DATA_DIR = path.join(work, 'data');

try {
  const first = path.join(work, 'first.mp4');
  const second = path.join(work, 'second.mp4');
  const output = path.join(work, 'merged.mp4');
  const edited = path.join(work, 'edited.mp4');
  const bgm = path.join(work, 'bgm.m4a');
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=0.8:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-y', first,
  ]);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3',
    '-c:a', 'aac', '-y', bgm,
  ]);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=240x320:d=0.7:r=24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', second,
  ]);

  const {
    buildContinuationInstruction, buildIdentityLockInstruction, continuationReferences, mergeVideoClips,
  } = await import('../server/src/canvasMedia.js');
  const { analyzeVideoQuality, extractIdentityFrames } = await import('../server/src/canvasQuality.js');
  const references = await continuationReferences(first);
  assert.match(references.lastFrame.url, /^data:image\/jpeg;base64,/);
  assert.equal(references.motionFrames.length, 2);
  for (const frame of references.motionFrames) assert.match(frame.url, /^data:image\/jpeg;base64,/);
  assert.match(references.video.url, /^data:video\/mp4;base64,/);
  assert.match(buildContinuationInstruction({ motionFrameCount: 2 }), /【图2】至【图3】/);
  assert.match(buildIdentityLockInstruction({ startIndex: 4, count: 2, label: '测试人物' }), /【图4】至【图5】/);
  const quality = await analyzeVideoQuality(first, { expectedDuration: 0.8, threshold: 75 });
  assert.equal(typeof quality.score, 'number');
  assert.equal(quality.technical.width, 320);
  const identityFrames = await extractIdentityFrames(first, 3);
  assert.equal(identityFrames.length, 3);
  assert.match(identityFrames[0].url, /^data:image\/jpeg;base64,/);

  const result = await mergeVideoClips([first, second], output);
  assert.ok(result.bytes > 0);
  assert.ok(fs.existsSync(output));
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]);
  const duration = Number(stdout.trim());
  assert.ok(duration > 1.3 && duration < 2.2, `unexpected merged duration: ${duration}`);
  const editedResult = await mergeVideoClips([
    { file: first, trimStart: 0.1, trimEnd: 0.1, volume: 0.7, transition: 'cut' },
    { file: second, trimStart: 0, trimEnd: 0.05, volume: 0, transition: 'fade', transitionDuration: 0.2 },
  ], edited, { outputSize: '1:1', bgmFile: bgm, bgmVolume: 0.2 });
  assert.equal(editedResult.width, 1080);
  assert.equal(editedResult.height, 1080);
  assert.ok(editedResult.duration > 0.8);
  const { stdout: editedProbe } = await exec('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', edited,
  ]);
  assert.match(editedProbe, /audio/);
  console.log(`canvas media test passed (${duration.toFixed(2)}s, ${result.bytes} bytes)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
