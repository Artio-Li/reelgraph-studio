import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const CFG = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST || '127.0.0.1',

  // 上游引擎 muse2api
  museBase: (process.env.MUSE_BASE || 'http://127.0.0.1:18610').replace(/\/+$/, ''),
  museKey: process.env.MUSE_KEY || 'm2a_your_secret_admin_key_here',

  // 平台自身
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtDays: num(process.env.JWT_DAYS, 14),

  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  publicBase: (process.env.PUBLIC_BASE || '').replace(/\/+$/, ''),

  // 定价（积分）
  price: {
    videoBase: num(process.env.PRICE_VIDEO_BASE, 10),
    videoPerSecond: num(process.env.PRICE_VIDEO_PER_SEC, 2),
    image: num(process.env.PRICE_IMAGE, 5),
  },
  signupCredits: num(process.env.SIGNUP_CREDITS, 100),

  // 允许自助注册
  allowRegister: (process.env.ALLOW_REGISTER ?? '1') !== '0',

  // 默认时长/画幅
  videoDurations: [5, 6, 8, 10],
  sizes: ['16:9', '9:16', '1:1', '4:3', '3:4'],
};

export const MEDIA_DIR = path.join(CFG.dataDir, 'media');
export const DB_FILE = path.join(CFG.dataDir, 'studio.db');
