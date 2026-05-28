#!/usr/bin/env node
/**
 * 指定周工作流：拉取该周榜单、生成异动、拉取 app metadata 与下载/收益，全部写入数据库。
 *
 * 日期约定（周一→周日）：
 *   - 入参为「本周一」；榜单 API 使用对应「周日」拉取，库中 rank_date 存周一。
 *   - 下载/收益（Top100 & 异动）：start_date = 本周一-7（上周一），end_date = 本周一-1（上周日），即「上一周 Mon~Sun」。
 *
 * 顺序：
 *   1. fetch_top100_to_db.js [本周一]  → API 拉取「上周日+本周日」榜单，rank_date 存上周一/本周一，写入 apple_top100 / android_top100
 *   2. generate_rank_changes_from_db.js → 从库中最新两个周一比对生成异动，写入 rank_changes + 榜单异动.csv
 *   3. fetch_app_metadata_to_db.js     → 从 Top100 表取 app_id，拉取 metadata 写入 app_metadata
 *   3.5. update_app_names_from_metadata.js → 从 app_metadata 更新 apple_top100 / android_top100 的 app_name
 *   4. fetch_top100_sales.js [本周一] → 为 Top100 写入「上一周」下载/收益，并同步覆盖 rank_changes 的 downloads/revenue
 *   5. refill_rank_changes_publisher.js   → 为 rank_changes 补全 publisher_name、store_url
 *   6. generate_top5_overview.js [本周一] → 汇总最近四周 Top5 趋势，生成「Top5 异动综述」写入 weekly_top5_overview
 *   7. fetch_us_free_metadata_and_compare.js [本周一] → US 免费榜商店页 metadata 变更检测，写入 weekly_metadata_snapshot / weekly_metadata_changes
 *   8. detect_removed_games.js [上周一] → 检查“上一周榜单”中的游戏是否在商店下架，写入 weekly_removed_games
 *
 * 运行：
 *   node workflow_week_rank_changes.js 2026-02-09
 *        → 指定「本周一」为 2026-02-09，完整跑完上述 6 步（默认数据库 sensortower_top100.db）
 *   node workflow_week_rank_changes.js 2026-02-09 my.db
 *        → 使用 my.db 作为数据库（不存在则在步骤 1 中创建）
 *
 * 依赖：.env 中配置 SENSORTOWER_API_TOKEN；系统有 sqlite3。
 */

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MONITOR_WEB_ROOT = path.resolve(ROOT, '..', '..', '..');

function resolvePath(value, fallback) {
  if (!value || !String(value).trim()) return fallback;
  const s = String(value).trim();
  return path.isAbsolute(s) ? s : path.join(ROOT, s);
}

const DB_FILE = resolvePath(
  process.env.SENSORTOWER_DB_FILE,
  path.join(MONITOR_WEB_ROOT, 'data', 'databases', 'sensortower_top100.db')
);

// 与 cron 兼容：用 Node 可执行路径调子脚本，避免 cron 环境下 PATH 无 node 导致 command not found
const NODE_PATH = process.execPath;
// cron 下 PATH 极简，子进程需能找到 sqlite3 等；前置常见路径
const CRON_FRIENDLY_PATH = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', process.env.PATH].filter(Boolean).join(':');

function run(name, cmd, dbFile) {
  console.log('\n' + '='.repeat(60));
  console.log('[工作流]', name);
  console.log('=', 60);
  const env = Object.assign({}, process.env);
  env.PATH = CRON_FRIENDLY_PATH;
  if (dbFile) env.SENSORTOWER_DB_FILE = dbFile;
  execSync(cmd, {
    cwd: path.join(ROOT, 'scripts'),
    stdio: 'inherit',
    shell: true,
    env,
  });
}

function getPreviousMonday(monday) {
  const d = new Date(monday + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 7);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function main() {
  const monday = process.argv[2];
  if (!monday || !/^\d{4}-\d{2}-\d{2}$/.test(monday.trim())) {
    console.error('用法: node workflow_week_rank_changes.js <本周一 YYYY-MM-DD>');
    console.error('示例: node workflow_week_rank_changes.js 2026-02-02');
    process.exit(1);
  }
  const m = monday.trim();
  const previousMonday = getPreviousMonday(m);
  if (!previousMonday) {
    console.error('无法从本周一推导上周一:', m);
    process.exit(1);
  }
  const dbArg = process.argv[3];
  const dbFile = dbArg
    ? (path.isAbsolute(dbArg) ? dbArg : path.join(ROOT, dbArg))
    : DB_FILE;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  if (!fs.existsSync(path.join(ROOT, '.env'))) {
    console.error('请先在项目根目录配置 .env，包含 SENSORTOWER_API_TOKEN');
    process.exit(1);
  }

  run(
    '1/8 抓取指定周 Top100（本周一 + 上周一）',
    `"${NODE_PATH}" fetch_top100_to_db.js ${m}`,
    dbFile
  );
  run(
    '2/8 生成榜单异动',
    `"${NODE_PATH}" generate_rank_changes_from_db.js`,
    dbFile
  );
  run(
    '3/8 拉取 App Metadata（ios + android）',
    `"${NODE_PATH}" fetch_app_metadata_to_db.js`,
    dbFile
  );
  run(
    '3.5/8 从 App Metadata 更新应用名称',
    `"${NODE_PATH}" update_app_names_from_metadata.js`,
    dbFile
  );
  run(
    '4/8 为 Top100 & 异动补充上一周下载/收益',
    `"${NODE_PATH}" fetch_top100_sales.js ${m}`,
    dbFile
  );
  run(
    '5/8 补全异动表的开发者/公司、商店链接',
    `"${NODE_PATH}" refill_rank_changes_publisher.js`,
    dbFile
  );
  run(
    '6/8 生成 Top5 异动综述（最近四周趋势）',
    `"${NODE_PATH}" generate_top5_overview.js ${m}`,
    dbFile
  );
  run(
    '7/8 US 免费榜商店页 metadata 变更检测',
    `"${NODE_PATH}" fetch_us_free_metadata_and_compare.js --date ${m}`,
    dbFile
  );
  run(
    '8/8 检测上一周 Top100 游戏是否下架',
    `"${NODE_PATH}" detect_removed_games.js ${previousMonday}`,
    dbFile
  );

  console.log('\n' + '='.repeat(60));
  console.log('指定周工作流全部完成。本周一:', m);
  console.log('  - apple_top100 / android_top100：已写入指定两周数据（应用名称已从 app_metadata 更新）');
  console.log('  - rank_changes：异动 + downloads/revenue + publisher_name + store_url');
  console.log('  - weekly_top5_overview：Top5 异动综述（最近四周）');
  console.log('  - weekly_metadata_snapshot / weekly_metadata_changes：US 免费榜商店页 metadata 快照与变更');
  console.log('  - weekly_removed_games：上一周 Top100 内疑似下架游戏记录（rank_date = ' + previousMonday + '）');
  console.log('  - app_metadata：Top100 涉及的 app 已拉取');
  console.log('  - app_name_cache：已从 app_metadata 更新');
  console.log('  - 榜单异动.csv：已更新');
  console.log('='.repeat(60));
}

main();
