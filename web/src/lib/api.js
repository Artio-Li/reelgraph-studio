const TOKEN_KEY = 'muse_studio_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error || data?.detail || `请求失败 (${res.status})`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  register: (b) => request('/api/auth/register', { method: 'POST', body: b }),
  login: (b) => request('/api/auth/login', { method: 'POST', body: b }),
  invite: () => request('/api/auth/invite'),
  me: () => request('/api/auth/me'),
  updateMe: (b) => request('/api/auth/me', { method: 'PATCH', body: b }),
  ledger: () => request('/api/auth/ledger'),

  meta: () => request('/api/meta'),

  accounts: () => request('/api/accounts'),
  refreshQuota: (accountId) => request('/api/accounts/quota', { method: 'POST', body: { accountId } }),
  importAccount: (b) => request('/api/accounts', { method: 'POST', body: b }),
  startCredentialImport: (b) => request('/api/accounts/credential-imports', { method: 'POST', body: b }),
  credentialImportStatus: (id) => request(`/api/accounts/credential-imports/${encodeURIComponent(id)}`),
  submitCredentialCode: (id, index, code) => request(
    `/api/accounts/credential-imports/${encodeURIComponent(id)}/code`,
    { method: 'POST', body: { index, code } },
  ),
  bindCode: (label) => request('/api/accounts/bind-code', { method: 'POST', body: { label } }),
  bindStatus: (code) => request(`/api/accounts/bind/${code}`),
  testAccount: (id) => request(`/api/accounts/${id}/test`, { method: 'POST' }),
  keepaliveAccount: (id) => request(`/api/accounts/${id}/keepalive`, { method: 'POST' }),
  testAccountProxy: (id, proxy) => request(`/api/accounts/${id}/proxy/test`, { method: 'POST', body: { proxy } }),
  saveAccountProxy: (id, proxy) => request(`/api/accounts/${id}/proxy`, { method: 'PATCH', body: { proxy } }),
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),

  createVideo: (b) => request('/api/videos', { method: 'POST', body: b }),
  createImage: (b) => request('/api/images', { method: 'POST', body: b }),
  geminiMeta: () => request('/api/gemini/meta'),
  generatePrompt: (b) => request('/api/gemini/prompts', { method: 'POST', body: b }),
  canvases: () => request('/api/canvases'),
  createCanvas: (b) => request('/api/canvases', { method: 'POST', body: b }),
  canvas: (id) => request(`/api/canvases/${encodeURIComponent(id)}`),
  saveCanvas: (id, b) => request(`/api/canvases/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  deleteCanvas: (id) => request(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewCanvasRun: (id, b) => request(`/api/canvases/${encodeURIComponent(id)}/runs/preview`, { method: 'POST', body: b }),
  runCanvas: (id, b) => request(`/api/canvases/${encodeURIComponent(id)}/runs`, { method: 'POST', body: b }),
  canvasRuns: (id, limit = 10) => request(`/api/canvases/${encodeURIComponent(id)}/runs?limit=${limit}`),
  canvasRun: (runId) => request(`/api/canvases/runs/${encodeURIComponent(runId)}/status`),
  jobs: (q = {}) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return request(`/api/jobs?${s.toString()}`);
  },
  job: (id) => request(`/api/jobs/${id}`),
  deleteJob: (id) => request(`/api/jobs/${id}`, { method: 'DELETE' }),

  upload: (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request('/api/upload', { method: 'POST', form: fd });
  },

  adminOverview: () => request('/api/admin/overview'),
  adminUsers: (q) => request(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminPatchUser: (id, b) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: b }),
  adminSettings: () => request('/api/admin/settings'),
  adminSaveSettings: (b) => request('/api/admin/settings', { method: 'PATCH', body: b }),
  adminTestGemini: () => request('/api/admin/gemini/test', { method: 'POST' }),
  adminSystem: () => request('/api/admin/system'),
  adminKeepalive: () => request('/api/admin/keepalive', { method: 'POST' }),
  adminOrders: (kind) => request(`/api/admin/orders${kind ? `?kind=${kind}` : ''}`),
  adminPosts: () => request('/api/admin/posts'),
  adminDeletePost: (id) => request(`/api/admin/posts/${id}`, { method: 'DELETE' }),
  adminTrend: () => request('/api/admin/trend'),

  keys: () => request('/api/keys'),
  createKey: (name) => request('/api/keys', { method: 'POST', body: { name } }),
  deleteKey: (id) => request(`/api/keys/${id}`, { method: 'DELETE' }),

  queue: () => request('/api/queue'),
  addQueue: (b) => request('/api/queue', { method: 'POST', body: b }),
  patchQueue: (id, b) => request(`/api/queue/${id}`, { method: 'PATCH', body: b }),
  moveQueue: (id, dir) => request(`/api/queue/${id}/move`, { method: 'POST', body: { dir } }),
  deleteQueue: (id) => request(`/api/queue/${id}`, { method: 'DELETE' }),
  clearQueueDone: () => request('/api/queue/done', { method: 'DELETE' }),
  clearQueueAll: () => request('/api/queue', { method: 'DELETE' }),

  team: () => request('/api/team'),
  transferCredits: (email, credits) => request('/api/team/transfer', { method: 'POST', body: { email, credits } }),
  joinTeam: (code) => request('/api/team/join', { method: 'POST', body: { code } }),

  chatModels: () => request('/api/chat/models'),
  chat: (b) => request('/api/chat', { method: 'POST', body: b }),

  membership: () => request('/api/membership'),
  subscribe: (plan) => request('/api/membership', { method: 'POST', body: { plan } }),
  recharge: (amount) => request('/api/recharge', { method: 'POST', body: { amount } }),
  orders: () => request('/api/recharge/orders'),

  posts: (q = {}) => {
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
    return request(`/api/posts?${s.toString()}`);
  },
  createPost: (b) => request('/api/posts', { method: 'POST', body: b }),
  likePost: (id) => request(`/api/posts/${id}/like`, { method: 'POST' }),
  replies: (id) => request(`/api/posts/${id}/replies`),
  replyPost: (id, content) => request(`/api/posts/${id}/replies`, { method: 'POST', body: { content } }),
};

export const fmtTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const fmtAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
};

export const fmtBytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
