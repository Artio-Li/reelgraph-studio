import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelgraph-chatgpt2api-'));
process.env.DATA_DIR = tempDir;
process.env.JWT_SECRET = 'chatgpt2api-provider-test-secret';

const calls = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  calls.push({ url: req.url, body });
  assert.equal(req.headers.authorization, 'Bearer sk-chatgpt2api-test');
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') {
    return res.end(JSON.stringify({ data: [
      { id: 'gpt-5-6-mini', name: 'GPT 5.6 Mini' },
      { id: 'gpt-image-2', name: 'GPT Image 2' },
    ] }));
  }
  if (req.url === '/v1/chat/completions') {
    return res.end(JSON.stringify({
      model: body.model,
      usage: { total_tokens: 9 },
      choices: [{ message: { content: 'mock chatgpt2api prompt' } }],
    }));
  }
  if (req.url === '/v1/images/generations') {
    assert.equal(body.model, 'gpt-image-2');
    assert.equal(body.response_format, 'b64_json');
    assert.equal(body.size, '1024x1536');
    return res.end(JSON.stringify({ model: body.model, data: [{ b64_json: PNG }] }));
  }
  if (req.url === '/v1/images/edits') {
    assert.equal(body.model, 'gpt-image-2');
    assert.equal(body.response_format, 'b64_json');
    assert.match(body.images[0], /^data:image\/png;base64,/);
    return res.end(JSON.stringify({ model: body.model, data: [{ b64_json: PNG }] }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const { setSetting, setSecretSetting } = await import('../server/src/db.js');
  const chatgpt2api = await import('../server/src/chatgpt2api.js');
  const address = server.address();
  setSetting('chatgpt2apiEnabled', '1');
  setSetting('chatgpt2apiBaseUrl', `http://127.0.0.1:${address.port}/v1`);
  setSetting('chatgpt2apiTextModel', 'gpt-5-6-mini');
  setSetting('chatgpt2apiImageModel', 'gpt-image-2');
  setSecretSetting('chatgpt2apiApiKey', 'sk-chatgpt2api-test');

  assert.equal(
    chatgpt2api.normalizeBaseUrl(`http://127.0.0.1:${address.port}/v1/`),
    `http://127.0.0.1:${address.port}`,
  );
  const models = await chatgpt2api.listModels({ force: true });
  assert.equal(models.text[0].id, 'gpt-5-6-mini');
  assert.equal(models.image[0].id, 'gpt-image-2');

  const text = await chatgpt2api.generateText({ messages: [{ role: 'user', content: 'test' }] });
  assert.equal(text.content, 'mock chatgpt2api prompt');

  const image = await chatgpt2api.generateImage({
    prompt: 'portrait', size: '9:16', resolution: '2K', jobId: 'plain',
  });
  assert.ok(fs.existsSync(path.join(tempDir, 'media', image.fileName)));

  const edited = await chatgpt2api.generateImage({
    prompt: 'keep the same face',
    images: [`data:image/png;base64,${PNG}`],
    jobId: 'reference',
  });
  assert.ok(fs.existsSync(path.join(tempDir, 'media', edited.fileName)));
  assert.deepEqual(
    calls.filter((item) => item.url.startsWith('/v1/images/')).map((item) => item.url),
    ['/v1/images/generations', '/v1/images/edits'],
  );
  console.log('ChatGPT2API provider mock test passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
