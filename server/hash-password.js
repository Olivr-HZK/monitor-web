/**
 * 生成登录密码的 bcrypt 哈希，用于写入 .env 的 LOGIN_PASSWORD_HASH
 * 用法: node hash-password.js 你的密码
 */
import bcrypt from 'bcryptjs';
const plain = process.argv[2];
if (!plain) {
  console.error('用法: node hash-password.js <你的密码>');
  process.exit(1);
}
const hash = bcrypt.hashSync(plain, 10);
console.log('把下面这一行加到 server/.env 中：');
console.log('LOGIN_PASSWORD_HASH=' + hash);
console.log('');
console.log('或直接设置：');
console.log('export LOGIN_PASSWORD_HASH="' + hash + '"');
process.exit(0);
