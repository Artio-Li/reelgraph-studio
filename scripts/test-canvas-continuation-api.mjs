import assert from 'node:assert/strict';

const base = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const email = process.env.TEST_EMAIL || process.env.ADMIN_EMAIL;
const password = process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error('set TEST_EMAIL/TEST_PASSWORD or ADMIN_EMAIL/ADMIN_PASSWORD');

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${data.error || response.status}`);
  return data;
}

const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
const token = login.token;
let canvasId;
try {
  const nodes = [
    { id: 'text_1', type: 'text', position: { x: 0, y: 0 }, data: { label: '第一段提示词', content: '第一段测试画面' } },
    { id: 'video_1', type: 'video', position: { x: 250, y: 0 }, data: { label: '第一段', duration: 5, size: '16:9' } },
    { id: 'text_2', type: 'text', position: { x: 0, y: 240 }, data: { label: '第二段提示词', content: '紧接上一段继续动作' } },
    { id: 'video_2', type: 'video', position: { x: 500, y: 240 }, data: { label: '第二段续集', duration: 5, size: '16:9' } },
    { id: 'board_1', type: 'storyboard', position: { x: 800, y: 100 }, data: { label: '顺序分镜板' } },
  ];
  const edges = [
    { id: 'e1', source: 'text_1', sourceHandle: 'text', target: 'video_1', targetHandle: 'prompt' },
    { id: 'e2', source: 'text_2', sourceHandle: 'text', target: 'video_2', targetHandle: 'prompt' },
    { id: 'e3', source: 'video_1', sourceHandle: 'video', target: 'video_2', targetHandle: 'continuation' },
    { id: 'e4', source: 'video_1', sourceHandle: 'video', target: 'board_1', targetHandle: 'clip', data: { order: 0 } },
    { id: 'e5', source: 'video_2', sourceHandle: 'video', target: 'board_1', targetHandle: 'clip', data: { order: 1 } },
  ];
  const created = await request('/api/canvases', {
    method: 'POST', token,
    body: { name: `continuation-api-test-${Date.now()}`, doc: { version: 3, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } },
  });
  canvasId = created.canvas.id;
  const { preview } = await request(`/api/canvases/${canvasId}/runs/preview`, {
    method: 'POST', token, body: { targetNodeIds: ['video_2'], force: true },
  });
  assert.equal(preview.total, 2, 'running the sequel must include its predecessor');
  assert.equal(preview.toGenerate, 2);
  assert.ok(preview.estimatedCost > 0);
  console.log(`canvas continuation API test passed (${preview.total} ordered video nodes)`);
} finally {
  if (canvasId) await request(`/api/canvases/${canvasId}`, { method: 'DELETE', token });
}
