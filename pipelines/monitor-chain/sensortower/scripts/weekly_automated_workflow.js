#!/usr/bin/env node
/**
 * 每周一自动执行完整工作流和商店信息爬取（定时任务入口）
 *
 * === 完整工作流逻辑 ===
 *
 * 1) 日期约定（周一→周日）
 *    - 所有脚本统一以「本周一」作为该周的标识（用户/定时任务只传周一）。
 *    - 榜单数据：API 请求使用「周日」日期拉取（周一 - 1 天），库中 rank_date 仍存「周一」。
 *    - 下载/收益：传入周一时，end_date = 周一-1（周日），start_date = 当周周一（周日-6），即整周 Mon~Sun。
 *
 * 2) 本脚本执行步骤
 *    - 计算「本周一」日期（本地时间）。
 *    - 步骤 1/2：运行 workflow_week_rank_changes.js <本周一>
 *        → 拉取该周+上周的周日榜单、生成异动、拉 metadata、更新名称、拉下载/收益（当周周一~周日）、补全 publisher、生成 Top5 综述、US 免费榜商店页 metadata 变更检测，以及对“上一周榜单”做下架检测。
 *    - 步骤 2/2：成功后再执行 send_sensortower_weekly_push.py --date <本周一>（飞书/企微 Markdown 周报）。
 *        跳过推送：环境变量 SKIP_SENSORTOWER_WEEKLY_PUSH=1。指定 Python：SENSORTOWER_WEEKLY_PUSH_PYTHON 或 PYTHON（推送脚本需 3.10+，勿用 macOS /usr/bin/python3 3.9）。
 *
 * 3) 数据库
 *    - 默认使用 data/sensortower_top100.db（可通过环境变量 SENSORTOWER_DB_FILE 覆盖）。
 *
 * 4) 定时任务（cron）
 *    - 建议：每周一 7:30 执行本脚本。
 *    - 示例：30 7 * * 1 cd /path/to/sensortower && node scripts/weekly_automated_workflow.js >> logs/weekly_workflow.log 2>&1
 *    - 或使用：bash scripts/setup_cron.sh
 *
 * 使用方法：
 *   node scripts/weekly_automated_workflow.js
 */

const path = require('path');
const fs = require('fs');
const { execSync, execFileSync } = require('child_process');

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
const LOG_DIR = resolvePath(
  process.env.SENSORTOWER_PIPELINE_LOG_DIR,
  path.join(MONITOR_WEB_ROOT, 'logs')
);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志文件
const LOG_FILE = path.join(LOG_DIR, `weekly_workflow_${new Date().toISOString().split('T')[0]}.log`);

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

function logError(message, error) {
  const timestamp = new Date().toISOString();
  const errorMessage = `[${timestamp}] ERROR: ${message}${error ? ': ' + error.message : ''}`;
  console.error(errorMessage);
  if (error && error.stack) {
    console.error(error.stack);
  }
  fs.appendFileSync(LOG_FILE, errorMessage + '\n');
  if (error && error.stack) {
    fs.appendFileSync(LOG_FILE, error.stack + '\n');
  }
}

/**
 * 获取本周一的日期（格式：YYYY-MM-DD）
 */
function getThisMonday() {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day; // 如果是周日，往前推6天；否则推到周一
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(monday.getDate()).padStart(2, '0');

  return `${year}-${month}-${dayOfMonth}`;
}

/** 用于 send_sensortower_weekly_push.py（需 Python 3.10+）；优先 Homebrew，避免 command -v 命中 /usr/bin/python3 3.9 */
function pythonAtLeast310(pyPath, extraEnv) {
  try {
    execFileSync(pyPath, ['-c', 'import sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) else 1)'], {
      stdio: 'ignore',
      env: extraEnv,
    });
    return true;
  } catch (_) {
    return false;
  }
}

function resolvePythonForPush() {
  const fromEnv = String(process.env.SENSORTOWER_WEEKLY_PUSH_PYTHON || process.env.PYTHON || '').trim();
  if (fromEnv) return fromEnv;
  const pathAug = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH].filter(Boolean).join(':');
  const extraEnv = { ...process.env, PATH: pathAug };
  const candidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3'];
  let fromPath = '';
  try {
    fromPath = execSync('command -v python3', {
      encoding: 'utf8',
      env: extraEnv,
      shell: true,
    }).trim();
  } catch (_) {
    /* ignore */
  }
  if (fromPath && !candidates.includes(fromPath)) {
    candidates.push(fromPath);
  }
  for (const py of candidates) {
    if (!py) continue;
    if (py.includes(path.sep) && !fs.existsSync(py)) continue;
    if (pythonAtLeast310(py, extraEnv)) return py;
  }
  return 'python3';
}

/**
 * 执行命令并记录日志
 */
function runCommand(name, cmd, dbFile) {
  log(`\n${'='.repeat(60)}`);
  log(`开始执行: ${name}`);
  log(`${'='.repeat(60)}`);

  const env = Object.assign({}, process.env);
  // cron 下 PATH 极简，子进程需能找到 sqlite3 等
  env.PATH = ['/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', process.env.PATH].filter(Boolean).join(':');
  if (dbFile) env.SENSORTOWER_DB_FILE = dbFile;

  try {
    execSync(cmd, {
      cwd: path.join(ROOT, 'scripts'),
      stdio: 'inherit',
      shell: true,
      env,
    });
    log(`✓ ${name} 执行成功`);
    return true;
  } catch (error) {
    logError(`${name} 执行失败`, error);
    return false;
  }
}

function main() {
  const startTime = Date.now();
  log('='.repeat(60));
  log('每周自动工作流开始执行');
  log('='.repeat(60));

  // 检查并加载 .env，使子进程继承（cron 不会加载 shell 配置）
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    logError('未找到 .env 文件，请先配置 SENSORTOWER_API_TOKEN');
    process.exit(1);
  }
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) {
        const key = m[1];
        const val = m[2].trim().replace(/^["']|["']$/g, '');
        if (val !== '' && process.env[key] === undefined) process.env[key] = val;
      }
    }
  } catch (e) {
    logError('读取 .env 失败', e);
    process.exit(1);
  }

  // 检查数据库文件
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    log('数据库文件不存在，将在第一步创建');
  }

  // 获取本周一日期
  const monday = getThisMonday();
  log(`本周一日期: ${monday}`);

  // 使用当前 Node 可执行路径，避免 cron 环境下 PATH 无 node 导致 command not found
  const nodePath = process.execPath;

  const skipPush = process.env.SKIP_SENSORTOWER_WEEKLY_PUSH === '1';

  // 步骤 1: 执行完整周报工作流（Top100 + 异动 + metadata + 下载/收益 + Top5 综述 + 商店页变更 + 下架检测）
  log('\n📊 步骤 1/2: 执行完整周报工作流');
  const workflowSuccess = runCommand(
    '完整周报工作流',
    `"${nodePath}" workflow_week_rank_changes.js ${monday}`,
    DB_FILE
  );

  if (!workflowSuccess) {
    logError('完整周报工作流执行失败');
  }

  let pushSuccess = true;
  if (workflowSuccess && !skipPush) {
    const py = resolvePythonForPush();
    const pushScript = path.join(ROOT, 'scripts', 'send_sensortower_weekly_push.py');
    log('\n📨 步骤 2/2: SensorTower 周报推送（飞书/企微）');
    pushSuccess = runCommand(
      'SensorTower 周报推送',
      `"${py}" "${pushScript}" --db "${DB_FILE}" --date ${monday}`,
      null
    );
    if (!pushSuccess) {
      logError('SensorTower 周报推送失败');
    }
  } else if (workflowSuccess && skipPush) {
    log('\n⏭ 步骤 2/2: 已跳过周报推送（SKIP_SENSORTOWER_WEEKLY_PUSH=1）');
  }

  const pushLabel = skipPush ? 'SKIP' : pushSuccess ? 'OK' : 'FAIL';

  // 总结
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

  log('\n' + '='.repeat(60));
  log('每周自动工作流执行完成');
  log('='.repeat(60));
  log(`执行时间: ${duration} 分钟`);
  log(`步骤 — 完整周报: ${workflowSuccess ? 'OK' : 'FAIL'}；周报推送: ${workflowSuccess ? pushLabel : '—'}`);
  log(`日志文件: ${LOG_FILE}`);
  log('='.repeat(60));

  if (!workflowSuccess || (workflowSuccess && !skipPush && !pushSuccess)) {
    process.exit(1);
  }
}

main();
