import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgraph-antigravity-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'antigravity-provider-test-secret';

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  assert.equal(req.headers.authorization, 'Bearer sk-local-test');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') {
    return res.end(JSON.stringify({ data: [
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
      { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image' },
    ] }));
  }
  if (req.url === '/v1/chat/completions') {
    if (Array.isArray(body.messages?.[0]?.content)) {
      return res.end(JSON.stringify({
        model: body.model,
        choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }],
      }));
    }
    return res.end(JSON.stringify({
      model: body.model, usage: { total_tokens: 8 },
      choices: [{ message: { content: 'mock prompt result' } }],
    }));
  }
  if (req.url === '/v1/images/generations') {
    assert.equal(body.response_format, 'b64_json');
    return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const { setSetting, setSecretSetting } = await import('../server/src/db.js');
  const antigravity = await import('../server/src/antigravity.js');
  const address = server.address();
  setSetting('antigravityEnabled', '1');
  setSetting('antigravityBaseUrl', `http://127.0.0.1:${address.port}/v1`);
  setSecretSetting('antigravityApiKey', 'sk-local-test');

  assert.equal(antigravity.normalizeBaseUrl(`http://127.0.0.1:${address.port}/v1/`), `http://127.0.0.1:${address.port}`);
  const models = await antigravity.listModels({ force: true });
  assert.equal(models.text[0].id, 'gemini-3-flash');
  assert.equal(models.image[0].id, 'gemini-3-pro-image');

  const text = await antigravity.generateText({ messages: [{ role: 'user', content: 'test' }] });
  assert.equal(text.content, 'mock prompt result');

  const image = await antigravity.generateImage({ prompt: 'test image', jobId: 'plain' });
  assert.ok(fs.existsSync(path.join(tempDir, 'media', image.fileName)));
  const edited = await antigravity.generateImage({
    prompt: 'keep the same face', images: [`data:image/png;base64,${PNG}`], jobId: 'reference',
  });
  assert.ok(fs.existsSync(path.join(tempDir, 'media', edited.fileName)));
  console.log('Antigravity provider mock test passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
