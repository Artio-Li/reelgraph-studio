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
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=0.8:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-y', first,
  ]);
  await exec('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=240x320:d=0.7:r=24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', second,
  ]);

  const { continuationReferences, mergeVideoClips } = await import('../server/src/canvasMedia.js');
  const references = await continuationReferences(first);
  assert.match(references.lastFrame.url, /^data:image\/jpeg;base64,/);
  assert.match(references.video.url, /^data:video\/mp4;base64,/);

  const result = await mergeVideoClips([first, second], output);
  assert.ok(result.bytes > 0);
  assert.ok(fs.existsSync(output));
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]);
  const duration = Number(stdout.trim());
  assert.ok(duration > 1.3 && duration < 2.2, `unexpected merged duration: ${duration}`);
  console.log(`canvas media test passed (${duration.toFixed(2)}s, ${result.bytes} bytes)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
