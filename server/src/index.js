import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { CFG, MEDIA_DIR, ROOT } from './config.js';
import { db, getSettings } from './db.js';
import { requireAuth, createUser, findUserByEmail } from './auth.js';
import { startWorker } from './worker.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import genRoutes from './routes/generate.js';
import adminRoutes from './routes/admin.js';
import billingRoutes from './routes/billing.js';
import forumRoutes from './routes/forum.js';
import apiKeyRoutes from './routes/apikeys.js';
import v1Routes from './routes/v1.js';
import queueRoutes from './routes/queue.js';
import teamRoutes from './routes/team.js';
import chatRoutes from './routes/chat.js';
import canvasRoutes from './routes/canvases.js';
import geminiRoutes from './routes/gemini.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '80mb' }));

// 简易 CORS：开发期前端跑在 5173；绑定接口允许任意来源（用一次性 code 认证）
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isBind = req.path === '/api/accounts/bind' || req.path.startsWith('/api/accounts/bind/');
  if (origin && (isBind || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', isBind ? '*' : origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ------------------------------ 静态资源 ------------------------------ */
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: true }));
app.use('/uploads', express.static(path.join(CFG.dataDir, 'uploads'), { maxAge: '1d', fallthrough: true }));
// 浏览器扩展打包下载（scripts/build-extension.ps1 生成）
app.use('/download', express.static(path.join(ROOT, 'public'), { fallthrough: true }));

/* ------------------------------- 接口 ------------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    time: Date.now(),
    upstream: CFG.museBase,
    site: getSettings().siteName,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', apiKeyRoutes);   // /api/keys
app.use('/api', billingRoutes);
app.use('/api', forumRoutes);
app.use('/api', queueRoutes);
app.use('/api', teamRoutes);
app.use('/api', chatRoutes);
app.use('/api', geminiRoutes);
app.use('/api/canvases', canvasRoutes);
app.use('/api', genRoutes);

// OpenAI 兼容对外接口（用 sk- 密钥鉴权，转发到上游）
app.use('/v1', v1Routes);

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

/* --------------------------- 前端产物（生产） --------------------------- */
const webDist = path.join(ROOT, '..', 'web', 'dist');
// 注意：必须按路径段判断，否则 /api-platform 会被当成 API 前缀拦掉
const under = (p, base) => p === base || p.startsWith(base + '/');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false }));
  app.get('*', (req, res, next) => {
    if (under(req.path, '/api') || under(req.path, '/media') || under(req.path, '/uploads') || under(req.path, '/v1') || under(req.path, '/download')) {
      return next();
    }
    res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log('[server] 已挂载前端产物', webDist);
}

/* ------------------------------ 错误兜底 ------------------------------ */
app.use((err, _req, res, _next) => {
  console.error('[server] 未捕获异常:', err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

/* ------------------------------ 引导数据 ------------------------------ */
function bootstrap() {
  const email = (process.env.ADMIN_EMAIL || 'admin@reelgraph.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'change-this-before-public-deployment';
  const existing = findUserByEmail(email);
  if (!existing) {
    createUser({ email, password, name: '管理员', role: 'admin', credits: 10000 });
    console.log(`[server] 已创建管理员：${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[server] 警告：正在使用示例管理员密码，公网部署前必须通过 ADMIN_PASSWORD 修改');
    }
  }
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  console.log(`[server] 用户总数 ${n}，媒体目录 ${MEDIA_DIR}`);
}

bootstrap();
startWorker();

app.listen(CFG.port, CFG.host, () => {
  console.log(`[server] 平台后端已启动 http://${CFG.host}:${CFG.port}`);
  console.log(`[server] 上游 muse2api ${CFG.museBase}`);
});
