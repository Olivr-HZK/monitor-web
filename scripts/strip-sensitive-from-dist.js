/**
 * 部署前从 dist 删除少量敏感文件。
 * - 默认（纯静态）：保留 .db，站点自带数据；勿设置 VITE_API_BASE_URL。
 * - 前后端分离：构建时设 VITE_API_BASE_URL，且部署前设环境变量 STRIP_DIST_DB=1 再跑本脚本，会从 dist 去掉所有 .db/.sqlite。
 * - 应急纯静态发布：可设 KEEP_AUTH_CONFIG_IN_DIST=1，保留 dist 内 auth-config.json；生产默认不走该模式。
 * - SQLite 辅助文件（*-wal/*-shm）始终删除，避免发布未 checkpoint 的临时文件。
 * 使用：npm run build && node scripts/strip-sensitive-from-dist.js
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

/** 相对于 dist 根目录的敏感文件（不应以静态资源暴露） */
const SENSITIVE_IN_DIST = [
  '周报谷歌表单.csv',
  '热点日报.md',
  'report_documents.json',
  'auth-config.json',
];

function walkFiles(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, callback);
    else callback(full);
  }
}

if (!fs.existsSync(distDir)) {
  console.warn('strip-sensitive-from-dist: dist 不存在，跳过');
  process.exit(0);
}

const keepAuthConfig = process.env.KEEP_AUTH_CONFIG_IN_DIST === '1';

let removed = 0;
for (const name of SENSITIVE_IN_DIST) {
  if (keepAuthConfig && name === 'auth-config.json') {
    console.log('保留 dist 内 auth-config.json（KEEP_AUTH_CONFIG_IN_DIST=1）');
    continue;
  }
  const full = path.join(distDir, name);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    removed += 1;
    console.log('已从 dist 移除:', name);
  }
}

const stripDb = process.env.STRIP_DIST_DB === '1';
walkFiles(distDir, (full) => {
  const lower = full.toLowerCase();
  const isDb = lower.endsWith('.db') || lower.endsWith('.sqlite');
  const isSqliteSidecar =
    lower.endsWith('.db-shm') ||
    lower.endsWith('.db-wal') ||
    lower.endsWith('.sqlite-shm') ||
    lower.endsWith('.sqlite-wal');
  if ((stripDb && isDb) || isSqliteSidecar) {
    fs.unlinkSync(full);
    removed += 1;
    console.log('已从 dist 移除:', path.relative(distDir, full));
  }
});

if (removed > 0) {
  console.log(
    '共移除',
    removed,
    '个文件' +
      (stripDb ? '（含 .db，适用于前后端分离）' : '（纯静态保留 .db；敏感项见脚本内列表）') +
      '。'
  );
}
