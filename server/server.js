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
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'monitor-web-secret-change-in-production';
const LOGIN_USERNAME = process.env.LOGIN_USERNAME || 'admin';
const LOGIN_PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH;
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || process.env.app_id || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || process.env.app_secret || '';
const FEISHU_MEDIA_PUBLIC = process.env.FEISHU_MEDIA_PUBLIC === 'true';

// 无密码时允许本地开发：仅当未设置 LOGIN_PASSWORD_HASH 时，接受任意密码（仅限单用户）
const isDevNoPassword = !LOGIN_PASSWORD_HASH;
let feishuTokenCache = { token: '', expireAt: 0 };

async function getFeishuTenantToken() {
  const now = Date.now();
  if (feishuTokenCache.token && feishuTokenCache.expireAt > now + 60 * 1000) {
    return feishuTokenCache.token;
  }
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error('FEISHU_APP_ID/FEISHU_APP_SECRET 未配置');
  }
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`获取飞书 token 失败: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  if (!data?.tenant_access_token) {
    throw new Error('飞书 token 响应缺少 tenant_access_token');
  }
  const expires = Number(data.expire) || 3600;
  feishuTokenCache = { token: data.tenant_access_token, expireAt: now + expires * 1000 };
  return feishuTokenCache.token;
}

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

// 开发环境下 AI 对话不强制登录（前端可能是静态密码模式，没有 JWT）
const aiChatRequireAuth = process.env.NODE_ENV === 'production' && process.env.AI_CHAT_REQUIRE_AUTH !== 'false';
function aiChatAuth(req, res, next) {
  if (!aiChatRequireAuth) return next();
  return verifyAuth(req, res, next);
}

app.use(cookieParser());
app.use(express.json());

// 跨域：前端托管在 Google Pages / GitHub Pages 等时，需单独部署本后端并允许跨域请求
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

// 申请玩法解析（不要求登录，便于从企微链接进来的用户直接提交）
const DATA_DIR = path.join(__dirname, '..', 'data');
const GAMEPLAY_REQUESTS_FILE = path.join(DATA_DIR, 'gameplay_requests.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readGameplayRequests() {
  ensureDataDir();
  if (!fs.existsSync(GAMEPLAY_REQUESTS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(GAMEPLAY_REQUESTS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function appendGameplayRequest(payload) {
  const list = readGameplayRequests();
  list.push({
    gameName: payload.gameName,
    source: payload.source || 'wechat_douyin',
    remark: payload.remark || '',
    requestedAt: new Date().toISOString(),
  });
  fs.writeFileSync(GAMEPLAY_REQUESTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

async function notifyGameplayRequest(payload) {
  const feishu = (process.env.FEISHU_WEBHOOK_URL || '').trim();
  const wecom = (process.env.WECOM_WEBHOOK_URL_REAL || process.env.WECOM_WEBHOOK_URL || '').trim();
  const text = `【玩法解析申请】游戏：${payload.gameName}，来源：${payload.source || 'wechat_douyin'}${payload.remark ? `，备注：${payload.remark}` : ''}`;
  const md = `**玩法解析申请**\n- 游戏：${payload.gameName}\n- 来源：${payload.source || 'wechat_douyin'}${payload.remark ? `\n- 备注：${payload.remark}` : ''}`;
  if (feishu) {
    try {
      await fetch(feishu, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text } }),
      });
    } catch (e) {
      console.error('[feedback] 飞书通知失败:', e?.message || e);
    }
  }
  if (wecom) {
    try {
      await fetch(wecom, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { content: md } }),
      });
    } catch (e) {
      console.error('[feedback] 企业微信通知失败:', e?.message || e);
    }
  }
}

app.post('/api/feedback/gameplay-request', (req, res) => {
  const { gameName, source, remark } = req.body || {};
  const name = typeof gameName === 'string' ? gameName.trim() : '';
  if (!name) {
    return res.status(400).json({ error: '请填写游戏名称' });
  }
  const payload = { gameName: name, source: source || 'wechat_douyin', remark: remark || '' };
  try {
    appendGameplayRequest(payload);
    notifyGameplayRequest(payload).catch((e) => console.error('[feedback] notify:', e));
    return res.json({ ok: true });
  } catch (e) {
    console.error('[feedback] 写入失败:', e);
    return res.status(500).json({ error: '提交失败，请稍后重试' });
  }
});

const feishuMediaAuth = (req, res, next) => {
  if (FEISHU_MEDIA_PUBLIC || process.env.NODE_ENV !== 'production') {
    return next();
  }
  return verifyAuth(req, res, next);
};

// 飞书媒体代理（用于访问受控下载链接）
app.get('/api/feishu-media', feishuMediaAuth, async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) {
    return res.status(400).json({ error: '缺少 url 参数' });
  }
  const decodedUrl = rawUrl.includes('%') ? decodeURIComponent(rawUrl) : rawUrl;
  let targetUrl;
  try {
    targetUrl = new URL(decodedUrl);
  } catch {
    return res.status(400).json({ error: '非法 url', detail: decodedUrl.slice(0, 200) });
  }
  const hostname = targetUrl.hostname;
  const allowedHost =
    hostname.endsWith('feishu.cn') ||
    hostname.endsWith('open.feishu.cn') ||
    hostname.endsWith('larksuite.com');
  if (!allowedHost) {
    return res.status(400).json({ error: '非法域名', detail: hostname });
  }
  const allowedPath = /\/open-apis\/drive\/v1\/medias\//.test(targetUrl.pathname);
  if (!allowedPath) {
    return res.status(400).json({ error: '非法资源路径', detail: targetUrl.pathname });
  }
  try {
    const token = await getFeishuTenantToken();
    const upstream = await fetch(targetUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// AI 对话：代理到可配置的大模型服务（默认 OpenAI 兼容接口）
app.post('/api/ai/chat', aiChatAuth, async (req, res) => {
  try {
    const { message, history } = req.body || {};
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) {
      return res.status(400).json({ error: '缺少提问内容' });
    }

    const apiKey = (process.env.OPENAI_API_KEY || '').trim();
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'AI 服务未配置，请先在 server/.env 中配置 OPENAI_API_KEY' });
    }

    const messages = [];
    messages.push({
      role: 'system',
      content:
        '你是「监测汇总」内部平台的智能助手，擅长解读 AI 热点、趋势监测、休闲游戏监测和 AI 产品监测相关的数据和周报。回答时尽量用简洁的中文分点说明，给出可执行的建议。若问题超出本平台范围，也可以进行一般性答疑。',
    });
    if (Array.isArray(history)) {
      for (const m of history) {
        if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') continue;
        const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
        messages.push({ role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: text });

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ai-chat] upstream error:', resp.status, errText.slice(0, 500));
      return res.status(502).json({ error: '调用大模型失败，请稍后重试。' });
    }

    const data = await resp.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.delta?.content ||
      '';
    if (!content) {
      return res.status(500).json({ error: '大模型返回为空，请稍后重试。' });
    }
    return res.json({
      answer: content,
    });
  } catch (e) {
    console.error('[ai-chat] error:', e?.message || e);
    return res.status(500).json({ error: 'AI 对话服务异常，请稍后重试。' });
  }
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
    'sensortower_applist.db',
    'wechatdouyin.db',
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
