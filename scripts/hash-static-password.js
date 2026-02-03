/**
 * 生成静态访问密码的 SHA-256 哈希，用于 .env 的 VITE_STATIC_PASSWORD_HASH
 * 用法: node scripts/hash-static-password.js 你的密码
 */
import crypto from 'crypto';
const password = process.argv[2];
if (!password) {
  console.error('用法: node scripts/hash-static-password.js <你的访问密码>');
  process.exit(1);
}
const hash = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
console.log('将下面一行写入项目根目录的 .env 文件（没有则新建）：');
console.log('');
console.log('VITE_STATIC_PASSWORD_HASH=' + hash);
console.log('');
console.log('然后重新构建：npm run build');
process.exit(0);
