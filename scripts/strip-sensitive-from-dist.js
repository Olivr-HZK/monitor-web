/**
 * 静态托管前从 dist 中删除敏感文件，避免部署到 GitHub Pages 等后被任何人直接下载。
 * 使用方式：npm run build && node scripts/strip-sensitive-from-dist.js && gh-pages -d dist
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

/** 相对于 dist 的敏感文件（与后端 /api/data 白名单对应，仅不应以静态资源暴露）。数据库已允许部署，不再从此列表 strip。 */
const SENSITIVE_IN_DIST = [
  '周报谷歌表单.csv',
  '热点日报.md',
  'report_documents.json',
  'auth-config.json',
];

if (!fs.existsSync(distDir)) {
  console.warn('strip-sensitive-from-dist: dist 不存在，跳过');
  process.exit(0);
}

let removed = 0;
for (const name of SENSITIVE_IN_DIST) {
  const full = path.join(distDir, name);
  if (fs.existsSync(full)) {
    fs.unlinkSync(full);
    removed += 1;
    console.log('已从 dist 移除:', name);
  }
}
if (removed > 0) {
  console.log('共移除', removed, '个敏感文件，可安全部署静态站。');
}
