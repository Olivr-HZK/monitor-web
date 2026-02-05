/**
 * 监测汇总 - 登录与受保护数据后端
 * 提供 POST /api/login, GET /api/me, POST /api/logout, GET /api/data/:path
 */
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'monitor-web-secret-change-in-production';
const LOGIN_USERNAME = process.env.LOGIN_USERNAME || 'admin';
const LOGIN_PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH;

// 无密码时允许本地开发：仅当未设置 LOGIN_PASSWORD_HASH 时，接受任意密码（仅限单用户）
const isDevNoPassword = !LOGIN_PASSWORD_HASH;

function verifyAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload.username;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
}

app.use(cookieParser());
app.use(express.json());

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '请填写用户名和密码' });
  }
  if (username !== LOGIN_USERNAME) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  if (isDevNoPassword) {
    // 本地未配置哈希时，仅校验用户名
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.json({ user: username });
  }
  const ok = bcrypt.compareSync(password, LOGIN_PASSWORD_HASH);
  if (!ok) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
  res.json({ user: username });
});

// 当前用户
app.get('/api/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ user: payload.username });
  } catch {
    return res.status(401).json({ error: '登录已过期' });
  }
});

// 登出
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// 受保护的数据文件（从项目 public 目录读取）
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
// 允许的子目录前缀
const ALLOWED_PREFIXES = ['ai产品/', 'ai热点/', '休闲游戏检测/'];

app.get('/api/data/:filename', verifyAuth, (req, res) => {
  const raw = req.params.filename;
  const decoded = decodeURIComponent(raw);
  if (!decoded || decoded.includes('..')) {
    return res.status(400).json({ error: '非法路径' });
  }
  
  // 检查是否在允许的子目录中
  const isInAllowedSubdir = ALLOWED_PREFIXES.some(prefix => decoded.startsWith(prefix));
  
  // 允许根目录文件或允许的子目录文件
  if (decoded.includes('/')) {
    if (!isInAllowedSubdir) {
      return res.status(400).json({ error: '非法路径' });
    }
    const filePath = path.join(PUBLIC_DIR, decoded);
    // 确保路径在 PUBLIC_DIR 下且不存在目录遍历
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }
    return res.sendFile(filePath);
  }
  
  // 根目录文件白名单
  const ALLOWED_ROOT_FILES = new Set([
    'competitor_data.db',
    'videos.db',
    '周报谷歌表单.csv',
    '热点日报.md',
    'report_documents.json',
    'auth-config.json',
  ]);
  
  if (!ALLOWED_ROOT_FILES.has(decoded)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  const filePath = path.join(PUBLIC_DIR, decoded);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.sendFile(filePath);
});

// 生产环境：提供前端静态文件
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).end();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
  if (isDevNoPassword) {
    console.log('未设置 LOGIN_PASSWORD_HASH，当前仅校验用户名（任意密码）。请运行 node hash-password.js <密码> 并配置 .env');
  }
});
