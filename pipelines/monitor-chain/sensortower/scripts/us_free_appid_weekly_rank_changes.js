#!/usr/bin/env node
/**
 * 依据 data/appid_us.json 中 us_free_category_ranking_summary 的免费榜维度；
 * 可选 competitors：[{ name, apple_app_id?, google_app_id? }] 与本品共用同一套 summary 榜单维度，仅 app id 不同；飞书默认每个竞品嵌套在本品 collapsible_panel 内；**`--only-product` 单条推送**时竞品改为与本品**平级**的独立折叠块。正文均一致（备注 + 快捷链接 + 各维度排名）。
 * 可选字段 us_free_weekly_note（如「游戏总榜」）会写入本地简报「备注」行及飞书折叠块首行。
 * 用 category_history（与 Arrow Madness 相同）拉取「上上周日 vs 上周日」排名，写入独立 SQLite；
 * API 拉取按「同 os+device+category+chart_type」合并 app_ids，每批最多 30 个（见 scripts/test_category_history_batch_params.js）；
 * 若 summary 中没有任何维度，则对 game / casual / board / card / puzzle 五类各查一遍（iPhone+iPad+Android），
 * 并推送飞书（样式对齐 compare_and_summarize）。
 *
 * 用法（**默认仅日报总结**；周报已弱化，需显式 `--weekly`）：
 *   node scripts/us_free_appid_weekly_rank_changes.js
 *   node scripts/us_free_appid_weekly_rank_changes.js --weekly [DATE_NEW] [DATE_OLD]   # 周报（双消息等，暂少用）
 *   node scripts/us_free_appid_weekly_rank_changes.js [DATE_NEW] [DATE_OLD]          # 与默认相同：日报
 *   node scripts/us_free_appid_weekly_rank_changes.js --no-feishu
 *   node scripts/us_free_appid_weekly_rank_changes.js --no-wework
 *   node scripts/us_free_appid_weekly_rank_changes.js --feishu-only [DATE_NEW] [DATE_OLD]
 *   node scripts/us_free_appid_weekly_rank_changes.js --wework-only [DATE_NEW] [DATE_OLD]
 *   node scripts/us_free_appid_weekly_rank_changes.js --send-wework [DATE_NEW] [DATE_OLD]
 *   （与 --wework-only 等价，另支持别名 --wecom-only）
 *   node scripts/us_free_appid_weekly_rank_changes.js --verify-urls
 *   node scripts/us_free_appid_weekly_rank_changes.js --only-product <internal_name>
 *     仅本品 + 其竞品（与 appid_us.json 的 internal_name 完全一致）；飞书**只发一条**（仅折叠明细，无总结）；企微不发顶部游戏总榜摘要段落。
 *   node scripts/us_free_appid_weekly_rank_changes.js --weekly --summary-only
 *     与 `--weekly` 同用：飞书 / 企微**只发周报总结**，不发「单独」明细。
 *   node scripts/us_free_appid_weekly_rank_changes.js --compare-table
 *     与 `--only-product` 等组合：有竞品时横向对比本品与各竞品（**飞书单卡**用开放平台 **table 组件**；多产品折叠块内因平台限制仍用 Markdown 表；企微仍为 Markdown；无竞品则仍为折叠/列表）。
 *   node scripts/us_free_appid_weekly_rank_changes.js --no-competitors
 *     日报（默认）下跳过竞品维度；**仅拉取 iOS（iPhone）与 Android 的「游戏总榜」免费维度**（6014+topfreeapplications / game+topselling_free）；无 summary 时 fallback 也只拉这两条总榜、不再五类全拉；日环比「昨天 vs 前天」由 `US_FREE_DAILY_CALENDAR_TZ` 决定（**默认北京时间 `Asia/Shanghai`**，可与美区对齐为 `America/Los_Angeles`）。
 *
 * 环境：SENSORTOWER_API_TOKEN（全量拉数）、FEISHU_WEBHOOK_URL（飞书推送）、WEWORK_WEBHOOK_URL（企业微信机器人 markdown）；
 *       定时任务（cron）与本地一致：从项目根 `.env` 读取上述变量；更换 Webhook 地址只改 `.env`，勿写进 crontab。
 *       WEWORK_MARKDOWN_MAX_BYTES（可选，单条正文切分上限，默认 3800 字节，含序号后须 ≤4096）；
 *       SENSORTOWER_OVERVIEW_BASE（默认 https://app.sensortower-china.com）、
 *       ST_CHINA_OVERVIEW_PARENT_ID（可选，overview 路径中的 project_id）
 *       FEISHU_RANK_DETAIL_EXPANDED=1（可选，排名明细折叠面板默认展开；默认折叠）
 * 飞书：**默认日报**一条「日总结」卡（`buildFeishuDailySummaryCard`，无 note 页脚）。传 `--weekly` 时仍为总结+单独两条。`--only-product` 等为专项推送。折叠明细需 collapsible_panel（飞书 ≥7.9）。
 * 遇 11232 频率限制则退避重试。
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const initSqlJs = require("sql.js");
const { getRankFromData } = require("../arrow_madness_rank_parse.js");
const { walkFeishuInteractivePayload } = require("./feishu_shrink_inline_images.js");

const ROOT = path.join(__dirname, "..");

function resolvePath(value, fallback) {
  if (!value || !String(value).trim()) return fallback;
  const s = String(value).trim();
  return path.isAbsolute(s) ? s : path.join(ROOT, s);
}

const APPID_US_JSON = resolvePath(
  process.env.SENSORTOWER_APPID_US_JSON,
  path.join(ROOT, "resources", "appid_us.json")
);
const DB_PATH = resolvePath(
  process.env.US_FREE_APPID_WEEKLY_DB || process.env.APPID_US_COMPETITORS_DB,
  path.join(ROOT, "data", "us_free_appid_weekly.db")
);

const COUNTRY = "US";
const SENSORTOWER_API_HOST = "api.sensortower-china.com";

/** 与 Python SENSORTOWER_OVERVIEW_BASE 一致 */
const SENSORTOWER_OVERVIEW_BASE_DEFAULT = "https://app.sensortower-china.com";

const httpsAgent = new https.Agent({ keepAlive: false, maxSockets: 1 });
const REQUEST_TIMEOUT_MS = 90000;
const MAX_RETRIES = 6;
const BETWEEN_QUERIES_MS = 450;
/** 与 docs/API_DOCUMENTATION.md 一致：category_history 单请求最多约 30 个 app_id */
const CATEGORY_HISTORY_APP_IDS_BATCH = 30;

/** 仅推送企业微信；`--send-wework` / `--wecom-only` 与 `--wework-only` 等价 */
const ARG_WEEWORK_ONLY = new Set(["--wework-only", "--send-wework", "--wecom-only"]);

function argvHasWeworkOnly() {
  return process.argv.some((a) => ARG_WEEWORK_ONLY.has(a));
}

/**
 * @returns {{ noFeishu: boolean, noWework: boolean, feishuOnly: boolean, weworkOnly: boolean, daily: boolean, weekly: boolean, noCompetitors: boolean, onlyProduct: string|null, compareTable: boolean, summaryOnly: boolean, rest: string[] }}
 */
function parseRunFlags(argv) {
  const o = {
    noFeishu: false,
    noWework: false,
    feishuOnly: false,
    weworkOnly: false,
    daily: false,
    weekly: false,
    noCompetitors: false,
    onlyProduct: null,
    compareTable: false,
    summaryOnly: false,
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-feishu") o.noFeishu = true;
    else if (a === "--no-wework") o.noWework = true;
    else if (a === "--feishu-only") o.feishuOnly = true;
    else if (ARG_WEEWORK_ONLY.has(a)) o.weworkOnly = true;
    else if (a === "--daily") o.daily = true;
    else if (a === "--weekly") o.weekly = true;
    else if (a === "--no-competitors") o.noCompetitors = true;
    else if (a === "--compare-table") o.compareTable = true;
    else if (a === "--summary-only") o.summaryOnly = true;
    else if (a === "--only-product") {
      const v = argv[i + 1];
      if (v && !String(v).startsWith("--")) {
        o.onlyProduct = String(v).trim();
        i++;
      }
    } else o.rest.push(a);
  }
  if (o.weekly) {
    o.daily = false;
  } else if (!o.daily) {
    o.daily = true;
  }
  return o;
}

/** 某时区「今天」的日历日 YYYY-MM-DD（默认北京时间；可用 `US_FREE_DAILY_CALENDAR_TZ` 覆盖，如美西 `America/Los_Angeles`） */
function calendarDateYMDInTz(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getDefaultDailyDateRange() {
  const tz = String(process.env.US_FREE_DAILY_CALENDAR_TZ || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const today = calendarDateYMDInTz(tz);
  const dateNew = addDays(today, -1);
  const dateOld = addDays(dateNew, -1);
  return { dateOld, dateNew, tz };
}

/**
 * @param {string[]} restArgs 已去掉 flag 的 argv
 * @param {{ daily: boolean }} opts
 */
function resolveDateRangeFromArgs(restArgs, opts) {
  const daily = !!(opts && opts.daily);
  if (restArgs[0] && /^\d{4}-\d{2}-\d{2}$/.test(restArgs[0])) {
    const DATE_NEW = restArgs[0];
    const DATE_OLD =
      restArgs[1] && /^\d{4}-\d{2}-\d{2}$/.test(restArgs[1])
        ? restArgs[1]
        : daily
          ? addDays(DATE_NEW, -1)
          : addDays(DATE_NEW, -7);
    return { DATE_OLD, DATE_NEW };
  }
  if (daily) {
    const { dateOld, dateNew } = getDefaultDailyDateRange();
    return { DATE_OLD: dateOld, DATE_NEW: dateNew };
  }
  const DATE_NEW = getLastSunday();
  const DATE_OLD = addDays(DATE_NEW, -7);
  return { DATE_OLD, DATE_NEW };
}

function reportKindFromFlags(flags) {
  return flags.weekly ? "weekly" : "daily";
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getLastSunday(d = new Date()) {
  const day = d.getDay();
  const daysBack = day === 0 ? 7 : day;
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const dayNum = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayNum}`;
}

function addDays(ymd, delta) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(y, mo - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** 与 Arrow Madness 一致：iOS/iPad/Android + 游戏 + 子类；Android category_id=all 为「平台-总榜」（无「游戏」段） */
function rankCompactLabel(q) {
  const plat =
    q.os === "ios" ? (q.device === "iphone" ? "iOS" : "iPad") : "Android";
  let c = String(q.category);
  const m = /^category_(\d+)$/.exec(c);
  if (m) c = m[1];
  const cn = (q.category_name || "").toLowerCase();
  if (c === "all") return `${plat}-总榜`;
  let sub = "总榜";
  if (c === "7003" || c === "game_casual") sub = "休闲";
  else if (c === "7012" || c === "game_puzzle") sub = "解谜";
  else if (c === "7004" || c === "game_board") sub = "棋盘游戏";
  else if (c === "7005" || c === "game_card") sub = "卡牌游戏";
  else if (c === "6014" || c === "game") sub = "总榜";
  else if (cn.includes("board") || cn.includes("games/board")) sub = "棋盘游戏";
  else if (cn.includes("games/card") || /\bcard\b/i.test(q.category_name || "")) sub = "卡牌游戏";
  return `${plat}-游戏-${sub}`;
}

/** 简报 / 纯文本：仅两周名次，不含名次差 */
function formatRankCompactLine(q, o, n) {
  const label = rankCompactLabel(q);
  if (o == null && n == null) return `${label}：未上榜-未上榜`;
  if (o == null && n != null) return `${label}：未上榜-${n}`;
  if (o != null && n == null) return `${label}：${o}-未上榜`;
  return `${label}：${o}-${n}`;
}

/**
 * 飞书折叠明细：两周名次 + 名次差；diff=旧−新，>0 红（+），<0 绿（−）（名次数字变小为榜单更靠前）
 */
function formatRankCompactLineFeishu(q, o, n) {
  const label = rankCompactLabel(q);
  const L = `**${label}**`;
  if (o == null && n == null) return `${L}：未上榜-未上榜`;
  if (o == null && n != null) return `${L}：未上榜-${n}`;
  if (o != null && n == null) return `${L}：${o}-未上榜`;
  if (o === n) return `${L}：${o}-${n}`;
  const diff = o - n;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  const bracket = `（${paren}）`;
  const colored =
    diff > 0 ? `<font color='red'>${bracket}</font>` : `<font color='green'>${bracket}</font>`;
  return `${L}：${o}-${n}${colored}`;
}

function dedupeCharts(charts) {
  if (!charts || !charts.length) return [];
  const seen = new Set();
  const out = [];
  for (const c of charts) {
    const k = `${c.chart_type_id}|${c.category_id}|${c.chart_device || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * summary 里没有任何免费榜维度时，用固定五类拉 category_history：
 * 游戏总榜 game、休闲 casual、棋盘 board、卡牌 card、解谜 puzzle（与仓库内其它脚本 category id 一致）
 */
const FALLBACK_IOS_CATEGORY_ROWS = [
  { category: "6014", category_name: "Games" },
  { category: "7003", category_name: "Games/Casual" },
  { category: "7004", category_name: "Games/Board" },
  { category: "7005", category_name: "Games/Card" },
  { category: "7012", category_name: "Games/Puzzle" },
];

const FALLBACK_ANDROID_CATEGORY_ROWS = [
  { category: "game", category_name: "Game" },
  { category: "game_casual", category_name: "Game/Casual" },
  { category: "game_board", category_name: "Game/Board" },
  { category: "game_card", category_name: "Game/Card" },
  { category: "game_puzzle", category_name: "Game/Puzzle" },
];

/** 日报专用：仅 iOS iPhone 游戏总榜（6014）+ Android 游戏总榜（game） */
function isDailyGameTotalFreeQuery(q) {
  if (!q) return false;
  const c = normalizeCategoryForIntro(q);
  if (q.os === "android") {
    return c === "game" && q.chart_type_ids && q.chart_type_ids[0] === "topselling_free";
  }
  if (q.os === "ios") {
    return (
      c === "6014" &&
      q.device === "iphone" &&
      q.chart_type_ids &&
      q.chart_type_ids[0] === "topfreeapplications"
    );
  }
  return false;
}

/**
 * subject：与 appid_us 一条产品或竞品行对应的展示字段；含 apple_app_id / google_app_id。
 * @param {{ dailyTotalBoardsOnly?: boolean }} [opts] 为 true 时（日报）仅追加 iPhone Games 总榜 + Android Game 总榜各一条，不拉五类、不拉 iPad。
 */
function pushFallbackQueriesForSubject(subject, sum, out, opts) {
  const dailyTotalBoardsOnly = !!(opts && opts.dailyTotalBoardsOnly);
  const base = {
    internal_name: subject.internal_name,
    product_code: subject.product_code,
    display_name: subject.display_name,
    apple_app_id: subject.apple_app_id || null,
    google_app_id: subject.google_app_id || null,
    country: (sum && sum.country) || COUNTRY,
    st_overview_parent_id: subject.st_overview_parent_id || null,
    us_free_weekly_note: subject.us_free_weekly_note || null,
    competitorParent: subject.competitorParent != null ? subject.competitorParent : null,
  };

  if (dailyTotalBoardsOnly) {
    if (subject.apple_app_id) {
      const aid = String(subject.apple_app_id);
      out.push({
        ...base,
        q: {
          os: "ios",
          app_ids: [aid],
          category: "6014",
          chart_type_ids: ["topfreeapplications"],
          device: "iphone",
          category_name: "Games",
        },
      });
    }
    if (subject.google_app_id) {
      const gid = String(subject.google_app_id);
      out.push({
        ...base,
        q: {
          os: "android",
          app_ids: [gid],
          category: "game",
          chart_type_ids: ["topselling_free"],
          device: "android",
          category_name: "Game",
        },
      });
    }
    return;
  }

  if (subject.apple_app_id) {
    const aid = String(subject.apple_app_id);
    for (const rowCat of FALLBACK_IOS_CATEGORY_ROWS) {
      out.push({
        ...base,
        q: {
          os: "ios",
          app_ids: [aid],
          category: rowCat.category,
          chart_type_ids: ["topfreeapplications"],
          device: "iphone",
          category_name: rowCat.category_name,
        },
      });
      out.push({
        ...base,
        q: {
          os: "ios",
          app_ids: [aid],
          category: rowCat.category,
          chart_type_ids: ["topfreeipadapplications"],
          device: "ipad",
          category_name: rowCat.category_name,
        },
      });
    }
  }

  if (subject.google_app_id) {
    const gid = String(subject.google_app_id);
    for (const rowCat of FALLBACK_ANDROID_CATEGORY_ROWS) {
      out.push({
        ...base,
        q: {
          os: "android",
          app_ids: [gid],
          category: rowCat.category,
          chart_type_ids: ["topselling_free"],
          device: "android",
          category_name: rowCat.category_name,
        },
      });
    }
  }
}

/** 按 summary 中已有维度展开（与产品、竞品共用同一套 chart 列表） */
function pushQueriesFromSummary(subject, sum, out) {
  const ios = sum.ios && sum.ios.charts && !sum.ios._error ? dedupeCharts(sum.ios.charts) : [];
  for (const ch of ios) {
    if (!subject.apple_app_id) continue;
    if (ch.chart_type_id !== "topfreeapplications" && ch.chart_type_id !== "topfreeipadapplications") continue;
    const device = ch.chart_device === "ipad" ? "ipad" : "iphone";
    out.push({
      internal_name: subject.internal_name,
      product_code: subject.product_code,
      display_name: subject.display_name,
      apple_app_id: subject.apple_app_id || null,
      google_app_id: subject.google_app_id || null,
      country: (sum && sum.country) || COUNTRY,
      st_overview_parent_id: subject.st_overview_parent_id || null,
      us_free_weekly_note: subject.us_free_weekly_note || null,
      competitorParent: subject.competitorParent != null ? subject.competitorParent : null,
      q: {
        os: "ios",
        app_ids: [String(subject.apple_app_id)],
        category: String(ch.category_id),
        chart_type_ids: [ch.chart_type_id],
        device,
        category_name: ch.category_name || "",
      },
    });
  }

  const android = sum.android && sum.android.charts && !sum.android._error ? dedupeCharts(sum.android.charts) : [];
  for (const ch of android) {
    if (!subject.google_app_id) continue;
    if (ch.chart_type_id !== "topselling_free") continue;
    out.push({
      internal_name: subject.internal_name,
      product_code: subject.product_code,
      display_name: subject.display_name,
      apple_app_id: subject.apple_app_id || null,
      google_app_id: subject.google_app_id || null,
      country: (sum && sum.country) || COUNTRY,
      st_overview_parent_id: subject.st_overview_parent_id || null,
      us_free_weekly_note: subject.us_free_weekly_note || null,
      competitorParent: subject.competitorParent != null ? subject.competitorParent : null,
      q: {
        os: "android",
        app_ids: [String(subject.google_app_id)],
        category: String(ch.category_id),
        chart_type_ids: [ch.chart_type_id],
        device: "android",
        category_name: ch.category_name || "",
      },
    });
  }
}

/**
 * 从 appid_us 一条记录展开为若干 q（优先 summary 中已有免费榜维度；若一条都没有则查 game/casual/board/card/puzzle 五类）。
 * 可选 competitors[]：与本品共用同一套 summary 维度，仅替换 apple_app_id / google_app_id；internal_name 为「本品名·竞品·竞品名」。
 * @param {{ skipCompetitors?: boolean, dailyTotalBoardsOnly?: boolean }} [opts] skipCompetitors 为 true 时（如 `--daily`）不展开竞品；dailyTotalBoardsOnly 为 true 时（日报）仅保留 iOS iPhone 游戏总榜 + Android 游戏总榜。
 */
function expandQueriesForApp(row, opts) {
  const skipCompetitors = !!(opts && opts.skipCompetitors);
  const dailyTotalBoardsOnly = !!(opts && opts.dailyTotalBoardsOnly);
  const sum = row.us_free_category_ranking_summary;
  if (!sum || sum.country !== "US") return [];

  const out = [];

  const selfSubject = {
    internal_name: row.internal_name,
    product_code: row.product_code,
    display_name: row.display_name,
    apple_app_id: row.apple_app_id || null,
    google_app_id: row.google_app_id || null,
    st_overview_parent_id: row.st_overview_parent_id || null,
    us_free_weekly_note: row.us_free_weekly_note || null,
    competitorParent: null,
  };

  pushQueriesFromSummary(selfSubject, sum, out);
  if (out.length === 0) {
    pushFallbackQueriesForSubject(selfSubject, sum, out, { dailyTotalBoardsOnly });
  }

  if (!skipCompetitors) {
    const comps = Array.isArray(row.competitors) ? row.competitors : [];
    for (const comp of comps) {
      const cname = String(comp.name || "").trim();
      if (!cname) continue;
      const apple = comp.apple_app_id != null && String(comp.apple_app_id).trim() !== "" ? String(comp.apple_app_id).trim() : null;
      const google = comp.google_app_id != null && String(comp.google_app_id).trim() !== "" ? String(comp.google_app_id).trim() : null;
      if (!apple && !google) continue;

      const compSubject = {
        internal_name: `${row.internal_name}·竞品·${cname}`,
        product_code: row.product_code,
        display_name: cname,
        apple_app_id: apple,
        google_app_id: google,
        st_overview_parent_id: row.st_overview_parent_id || null,
        us_free_weekly_note: row.us_free_weekly_note || null,
        competitorParent: row.internal_name,
      };

      const before = out.length;
      pushQueriesFromSummary(compSubject, sum, out);
      if (out.length === before) {
        pushFallbackQueriesForSubject(compSubject, sum, out, { dailyTotalBoardsOnly });
      }
    }
  }

  if (dailyTotalBoardsOnly) {
    return out.filter((item) => item.q && isDailyGameTotalFreeQuery(item.q));
  }
  return out;
}

/** 必须含 app_id（同一 internal_name 可能对应多条 appid_us 行或不同包） */
function queryResultKey(internalName, q) {
  const aid = q.app_ids && q.app_ids[0] != null ? String(q.app_ids[0]) : "";
  return `${internalName}|${q.os}|${q.device}|${q.category}|${q.chart_type_ids[0]}|${aid}`;
}

/** 去掉完全相同的维度（常见于 appid_us 里重复 internal_name 且 summary 相同） */
function dedupeFlatQueries(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const k = queryResultKey(item.internal_name, item.q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** 同一 internal_name 多行（不同包 / 不同 product_code）时分组，避免飞书里合并成一块导致重复行 */
function productGroupKey(item) {
  return `${item.internal_name}\t${item.product_code || ""}\t${item.apple_app_id || ""}\t${item.google_app_id || ""}`;
}

/**
 * 飞书/链接展示名：优先 display_name（对外名称）；重名时保留 feishuLabel（由 assignInternalNameLabels 写入）
 */
function linkTitleForProduct(block) {
  const int = String(block.internalName || "").trim();
  const lbl = block.feishuLabel != null ? String(block.feishuLabel).trim() : "";
  if (lbl && int && lbl !== int) return lbl;
  const d = String(block.displayName || "").trim();
  if (d) return d;
  if (lbl) return lbl;
  return int || "产品";
}

/** 同一 internal_name 多条时标题为 name1、name2…；仅一条时不加后缀 */
function assignInternalNameLabels(productBlocks) {
  if (!productBlocks || !productBlocks.length) return productBlocks;
  const countBy = new Map();
  for (const b of productBlocks) {
    const key = String(b.internalName || "").trim() || "__empty__";
    countBy.set(key, (countBy.get(key) || 0) + 1);
  }
  const idxBy = new Map();
  for (const b of productBlocks) {
    const raw = String(b.internalName || "").trim() || "产品";
    const key = String(b.internalName || "").trim() || "__empty__";
    const total = countBy.get(key) || 1;
    if (total <= 1) {
      b.feishuLabel = raw;
    } else {
      const n = (idxBy.get(key) || 0) + 1;
      idxBy.set(key, n);
      b.feishuLabel = `${raw}${n}`;
    }
  }
  return productBlocks;
}

/** 各维度均为「未上榜-未上榜」时合并为一行展示 */
const RE_LINE_UNLISTED_FLAT = /：未上榜-未上榜$/;

function stripHtmlTags(s) {
  return String(s).replace(/<[^>]+>/g, "");
}

/** 企业微信：分榜明细 ### / #### 仅用标题文本（不加装饰 emoji，避免与游戏名混排） */
function formatWeWorkMarkdownH3Product(block, titleOpts) {
  const t = feishuPanelTitleFromProduct(block, titleOpts);
  return `### ${t}`;
}

/** 单产品推送时与本品同级（###），全量周报时竞品为 #### 缩进在本品下 */
function formatWeWorkMarkdownH3Competitor(c) {
  const t = feishuCompetitorPanelTitle(c);
  return `### ${t}`;
}

function formatWeWorkMarkdownH4Competitor(c) {
  const t = feishuCompetitorPanelTitle(c);
  return `#### ${t}`;
}

function compactDisplayRankLines(lines) {
  if (!lines || lines.length === 0) return [];
  const allUnlisted = lines.every((ln) => RE_LINE_UNLISTED_FLAT.test(stripHtmlTags(ln)));
  if (allUnlisted) {
    return ["各分榜均未上榜，环比持平"];
  }
  return lines;
}

function normalizeCategoryForIntro(q) {
  let c = String(q.category);
  const m = /^category_(\d+)$/.exec(c);
  if (m) c = m[1];
  return c;
}

/** iOS Games 总榜 / Android game 类总榜，用于顶部「游戏 + 端」摘要 */
function isGameTotalBoardQuery(q) {
  const c = normalizeCategoryForIntro(q);
  return c === "6014" || c === "game";
}

function introPlatformTag(q) {
  if (q.os === "android") return "android";
  return q.device === "ipad" ? "ipad" : "ios";
}

const INTRO_PLATFORM_ORDER = { ios: 0, android: 1, ipad: 2 };

function introGameEntryHasChange(o, n) {
  if (o == null && n == null) return false;
  if (o == null && n != null) return true;
  if (o != null && n == null) return true;
  if (o === n) return false;
  return true;
}

function formatIntroRankToken(r) {
  if (r == null) return "未上榜";
  return String(r);
}

function formatIntroRankPair(o, n) {
  return `${formatIntroRankToken(o)}→${formatIntroRankToken(n)}`;
}

/** 与 formatRankCompactLineFeishu 一致：旧 − 新；仅两端均为数字时有效 */
function introRankDiffOldMinusNew(o, n) {
  if (o == null || n == null) return null;
  const a = Number(o);
  const b = Number(n);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return a - b;
}

/** 飞书 Markdown：红（+）/绿（−）对应 diff=旧−新 正负，与明细一致 */
function formatIntroRankPairWithAbsFeishu(o, n) {
  const pair = formatIntroRankPair(o, n);
  const diff = introRankDiffOldMinusNew(o, n);
  if (diff == null || diff === 0) return pair;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  const bracket = `（${paren}）`;
  const colored =
    diff > 0 ? `<font color='red'>${bracket}</font>` : `<font color='green'>${bracket}</font>`;
  return `${pair}${colored}`;
}

/** 折叠标题 plain_text：无 HTML，仅 +/− 与数值 */
function formatIntroRankPairWithAbsPlain(o, n) {
  const pair = formatIntroRankPair(o, n);
  const diff = introRankDiffOldMinusNew(o, n);
  if (diff == null || diff === 0) return pair;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  return `${pair}（${paren}）`;
}

/** 企业微信 Markdown：无 font 标签，仅（+25）/（-25） */
function formatIntroRankPairWithAbsWework(o, n) {
  const pair = formatIntroRankPair(o, n);
  const diff = introRankDiffOldMinusNew(o, n);
  if (diff == null || diff === 0) return pair;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  return `${pair}（${paren}）`;
}

function sortIntroEntriesByPlatform(entries) {
  return [...entries].sort(
    (a, b) =>
      (INTRO_PLATFORM_ORDER[introPlatformTag(a.q)] ?? 99) -
      (INTRO_PLATFORM_ORDER[introPlatformTag(b.q)] ?? 99),
  );
}

/** 摘要分块：上升 / 下降（与 formatRankCompactLineFeishu 同向：diff=旧−新） */
function introRankDirectionForSummary(o, n) {
  if (o == null && n == null) return null;
  if (o == null && n != null) return "up";
  if (o != null && n == null) return "down";
  const diff = introRankDiffOldMinusNew(o, n);
  if (diff == null || diff === 0 || Number.isNaN(diff)) return null;
  return diff > 0 ? "up" : "down";
}

/** 游戏总榜摘要：含 iPhone / Android / iPad 三端变化条目；`dailyTotalBoardsOnly` 时仅 iPhone Games 总榜 + Android Game 总榜 */
function getGameTotalChangedEntriesForIntro(block, opts) {
  const entries = (block.rankEntries || []).filter((e) => isGameTotalBoardQuery(e.q));
  let changed = entries.filter((e) => introGameEntryHasChange(e.oldRank, e.newRank));
  changed = changed.filter((e) => {
    const t = introPlatformTag(e.q);
    return t === "ios" || t === "android" || t === "ipad";
  });
  if (opts && opts.dailyTotalBoardsOnly) {
    changed = changed.filter((e) => isDailyGameTotalFreeQuery(e.q));
  }
  return changed;
}

/**
 * 由已筛好的 rankEntry 列表拼游戏总榜括号（ios / android / iPad）
 * @param {{ plainText?: boolean, htmlColors?: boolean }} [opts] htmlColors=false 时为企业微信（无 font）
 */
function buildIosAndroidParenFromEntries(entries, opts) {
  if (!entries || !entries.length) return "";
  const plainText = opts && opts.plainText;
  const htmlColors = opts && opts.htmlColors !== false && !plainText;
  let fmt;
  if (plainText) fmt = formatIntroRankPairWithAbsPlain;
  else if (htmlColors) fmt = formatIntroRankPairWithAbsFeishu;
  else fmt = formatIntroRankPairWithAbsWework;
  const sorted = sortIntroEntriesByPlatform(entries);
  const parts = sorted.map((e) => `${introPlatformTag(e.q)} ${fmt(e.oldRank, e.newRank)}`);
  return `（${parts.join("，")}）`;
}

/**
 * @param {{ weWorkIntro?: boolean }} [opts] 企微日报：用「•」+ 链接内不加粗，避免列表/加粗被渲染成「下划线」观感
 */
function buildIntroProductHeadLine(block, opts) {
  const name = linkTitleForProduct(block);
  const st = sensorTowerUrlForIds(block.ids || {}, opts && opts.weWorkIntro ? { omitProjectId: true } : undefined);
  const label = escapeMdLinkLabel(name);
  if (opts && opts.weWorkIntro) {
    return st ? `• [${label}](${st})` : `• ${label}`;
  }
  return st ? `- [**${label}**](${st})` : `- **${label}**`;
}

/**
 * 游戏名后全角括号：**ios / android / iPad** 游戏总榜环比（与总结一致）
 * @param {{ plainText?: boolean, htmlColors?: boolean }} [opts] 折叠标题 plain_text 时 true（无颜色标签，仅 +/−）
 */
function buildIosAndroidGameTotalParen(block, opts) {
  return buildIosAndroidParenFromEntries(getGameTotalChangedEntriesForIntro(block, opts), opts);
}

/** 顶部摘要是否展示：ios / android / iPad 任一端游戏总榜有变化即展示；日报仅 iPhone/Android 游戏总榜两维 */
function productHasGameTotalIntroChange(block, opts) {
  const entries = (block.rankEntries || []).filter((e) => isGameTotalBoardQuery(e.q));
  return entries.some((e) => {
    if (opts && opts.dailyTotalBoardsOnly) {
      if (!isDailyGameTotalFreeQuery(e.q)) return false;
    }
    const t = introPlatformTag(e.q);
    if (t !== "ios" && t !== "android" && t !== "ipad") return false;
    return introGameEntryHasChange(e.oldRank, e.newRank);
  });
}

function sortBlocksByLabel(blocks) {
  return [...blocks].sort((a, b) =>
    linkTitleForProduct(a).localeCompare(linkTitleForProduct(b), "zh-CN"),
  );
}

/** internal_name 形如「本品·竞品·竞品名」时挂到本品折叠块下 */
const RE_COMPETITOR_INTERNAL = /^(.+)·竞品·(.+)$/;

/**
 * 将竞品块合并进对应本品块 competitorPanels；无法匹配本品的竞品仍作独立块排在后面。
 * @returns {Array}
 */
function mergeCompetitorBlocksIntoParents(blocks) {
  if (!blocks || !blocks.length) return blocks;
  const byParent = new Map();
  const parents = [];
  for (const b of blocks) {
    const m = RE_COMPETITOR_INTERNAL.exec(String(b.internalName || ""));
    if (m) {
      const parentKey = m[1];
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey).push(b);
    } else {
      parents.push(b);
    }
  }
  for (const p of parents) {
    const comps = byParent.get(p.internalName);
    if (comps && comps.length) {
      p.competitorPanels = comps
        .sort((a, b) =>
          String(a.displayName || "").localeCompare(String(b.displayName || ""), "zh-CN"),
        )
        .map((c) => {
          c.feishuLabel = String(c.displayName || "").trim() || String(c.internalName || "");
          return c;
        });
      byParent.delete(p.internalName);
    } else {
      p.competitorPanels = [];
    }
  }
  const orphans = [];
  for (const arr of byParent.values()) orphans.push(...arr);
  orphans.sort((a, b) => linkTitleForProduct(a).localeCompare(linkTitleForProduct(b), "zh-CN"));
  return parents.concat(orphans);
}

/** 仅保留指定本品块（含已并入的 competitorPanels）；internal_name 须与 appid_us 一致 */
function filterMergedBlocksToSingleProduct(blocks, internalName) {
  const needle = String(internalName || "").trim();
  if (!needle || !blocks || !blocks.length) return blocks;
  const parent = blocks.find(
    (b) => !RE_COMPETITOR_INTERNAL.test(String(b.internalName || "")) && String(b.internalName || "").trim() === needle,
  );
  if (parent) return [parent];
  const fuzzy = blocks.find(
    (b) =>
      !RE_COMPETITOR_INTERNAL.test(String(b.internalName || "")) &&
      String(b.internalName || "").includes(needle),
  );
  return fuzzy ? [fuzzy] : [];
}

/** 按 rankEntries 与 isGameTotalBoardQuery 拆成游戏总榜行 vs 其余分榜行 */
function partitionRankLinesByGameTotal(block) {
  const entries = block.rankEntries || [];
  const feishu = block.rankLines || [];
  const plain = block.plainRankLines || [];
  const totalF = [];
  const restF = [];
  const totalP = [];
  const restP = [];
  for (let i = 0; i < entries.length; i++) {
    if (isGameTotalBoardQuery(entries[i].q)) {
      totalF.push(feishu[i]);
      totalP.push(plain[i]);
    } else {
      restF.push(feishu[i]);
      restP.push(plain[i]);
    }
  }
  return { totalF, restF, totalP, restP };
}

/**
 * 折叠块内 Markdown：备注 + 快捷链接 + 各维度排名（本品与竞品同一套；游戏名仅在折叠标题 / 企业微信 ### 行出现一次）
 */
function buildRankPanelMarkdownBody(block, opts) {
  const channel = (opts && opts.channel) || "feishu";
  const weworkStrip = channel === "wework";
  const ids = block.ids || {};
  const st = sensorTowerUrlForIds(ids, weworkStrip ? { omitProjectId: true } : undefined);
  const linkLabel = linkTitleForProduct(block);
  const parts = [];
  if (st) {
    parts.push(`[${escapeMdLinkLabel(linkLabel)}](${st})`);
  } else {
    parts.push(escapeMdLinkLabel(linkLabel));
  }
  if (ids.apple_app_id) parts.push(`[前往 Apple Store](${appleStoreUrl(ids.apple_app_id)})`);
  if (ids.google_app_id) parts.push(`[前往 Google Play](${googlePlayUrl(ids.google_app_id)})`);
  const headerMd = parts.join("  ");
  const noteLine = block.weeklySummaryNote
    ? `**备注** · ${block.weeklySummaryNote}\n\n`
    : "";
  let lines = compactDisplayRankLines(block.rankLines || []);
  if (weworkStrip) lines = lines.map((ln) => stripHtmlTags(ln));
  const body = lines.join("\n");
  if (body) {
    return `${noteLine}**快捷链接** · ${headerMd}\n\n**各维度排名**\n${body}`;
  }
  return `${noteLine}**快捷链接** · ${headerMd}`;
}

/** 同一榜单维度在不同 app 间对齐（不含 internal_name / app_id） */
function queryDimensionKey(q) {
  if (!q) return "";
  const ct = q.chart_type_ids && q.chart_type_ids[0] != null ? String(q.chart_type_ids[0]) : "";
  return `${q.os}|${q.device}|${q.category}|${ct}`;
}

function buildRankEntryMap(block) {
  const m = new Map();
  for (const e of block.rankEntries || []) {
    m.set(queryDimensionKey(e.q), e);
  }
  return m;
}

function mdTableCell(s) {
  return String(s == null ? "" : s).replace(/\|/g, "｜").replace(/\r?\n/g, " ");
}

function formatRankTableCellFeishu(o, n) {
  if (o == null && n == null) return "未上榜-未上榜";
  if (o == null && n != null) return `未上榜-${n}`;
  if (o != null && n == null) return `${o}-未上榜`;
  if (o === n) return `${o}-${n}`;
  const diff = o - n;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  const colored = diff > 0 ? `<font color='red'>${paren}</font>` : `<font color='green'>${paren}</font>`;
  return `${o}-${n}（${colored}）`;
}

/** 飞书卡片对比表列宽（px），与 feishu_compare_table_kit 一致 */
const FEISHU_COMPARE_TABLE_DIM_WIDTH = "160px";
const FEISHU_COMPARE_TABLE_PRODUCT_COL_WIDTH = "160px";

function formatRankTableCellWeWork(o, n) {
  if (o == null && n == null) return "未上榜-未上榜";
  if (o == null && n != null) return `未上榜-${n}`;
  if (o != null && n == null) return `${o}-未上榜`;
  if (o === n) return `${o}-${n}`;
  const diff = o - n;
  const paren = diff > 0 ? `+${diff}` : `${diff}`;
  return `${o}-${n}（${paren}）`;
}

/**
 * 本品 + 竞品：行=榜单维度，列=各 app；单元格为「旧-新（差）」
 * @param {{ channel?: 'feishu'|'wework' }} [opts]
 */
function buildRankComparisonTableMarkdown(block, opts) {
  const channel = (opts && opts.channel) || "feishu";
  const fmt = channel === "wework" ? formatRankTableCellWeWork : formatRankTableCellFeishu;
  const cols = [block, ...(block.competitorPanels || [])];
  const maps = cols.map((b) => buildRankEntryMap(b));
  const parentEntries = block.rankEntries || [];
  if (parentEntries.length === 0) return "（无维度数据）";
  const headNames = cols.map((c) => mdTableCell(linkTitleForProduct(c)));
  const lines = [];
  lines.push(`| ${mdTableCell("维度")} | ${headNames.join(" | ")} |`);
  lines.push(`| ${["---", ...cols.map(() => "---")].join(" | ")} |`);
  for (const e of parentEntries) {
    const dk = queryDimensionKey(e.q);
    const rowLabel = rankCompactLabel(e.q);
    const cells = [];
    for (let i = 0; i < cols.length; i++) {
      const ent = i === 0 ? e : maps[i].get(dk);
      const o = ent ? ent.oldRank : null;
      const n = ent ? ent.newRank : null;
      cells.push(mdTableCell(fmt(o, n)));
    }
    lines.push(`| ${mdTableCell(rowLabel)} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function buildProductQuickLinksLine(block, stUrlOpts) {
  const ids = block.ids || {};
  const st = sensorTowerUrlForIds(ids, stUrlOpts);
  const name = linkTitleForProduct(block);
  const nameMd = st
    ? `[${escapeMdLinkLabel(name)}](${st})`
    : escapeMdLinkLabel(name);
  const linkParts = [];
  if (ids.apple_app_id) linkParts.push(`[Apple](${appleStoreUrl(ids.apple_app_id)})`);
  if (ids.google_app_id) linkParts.push(`[Google](${googlePlayUrl(ids.google_app_id)})`);
  return `- ${nameMd}  ${linkParts.join("  ")}`;
}

function buildCompareTableLinksSection(block, opts) {
  const stUrlOpts = opts && opts.wework ? { omitProjectId: true } : undefined;
  const out = [buildProductQuickLinksLine(block, stUrlOpts)];
  for (const c of block.competitorPanels || []) {
    out.push(buildProductQuickLinksLine(c, stUrlOpts));
  }
  return out.join("\n");
}

/** 对比表卡片：说明与链接（不含表格；表格用根级 `tag:table` 组件，见 buildFeishuRankComparisonTableElement） */
function buildFeishuCompareTableIntroMarkdown(block, dateOld, dateNew) {
  const lines = [];
  if (block.weeklySummaryNote) {
    lines.push(`**备注** · ${block.weeklySummaryNote}`);
    lines.push("");
  }
  lines.push(
    "**📍 美国 US** · 免费榜（iPhone / iPad / Android）",
    "",
    `**对比区间** · ${dateOld} → ${dateNew}`,
    "",
    "**相关链接**",
    buildCompareTableLinksSection(block),
    "",
    "**排名变化详情**",
  );
  return lines.join("\n");
}

/**
 * 飞书卡片根级表格组件（JSON 1.0）。不可放在 collapsible_panel 内，故多产品折叠块仍用 Markdown 表。
 * @see https://open.feishu.cn/document/feishu-cards/card-components/content-components/table
 */
function truncateFeishuTableHeader(s, maxLen) {
  const t = String(s || "").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(1, maxLen - 1))}…`;
}

function feishuPlainTableCellText(s) {
  return String(s == null ? "" : s).replace(/\r?\n/g, " ");
}

function buildFeishuRankComparisonTableElement(block) {
  const cols = [block, ...(block.competitorPanels || [])];
  const maps = cols.map((b) => buildRankEntryMap(b));
  const parentEntries = block.rankEntries || [];
  const headerStyle = {
    text_align: "left",
    text_size: "normal",
    background_style: "grey",
    text_color: "default",
    bold: true,
    lines: 1,
  };
  if (parentEntries.length === 0) {
    return {
      tag: "table",
      page_size: 5,
      row_height: "low",
      freeze_first_column: true,
      header_style: headerStyle,
      columns: [
        {
          name: "dim",
          display_name: "维度",
          data_type: "text",
          horizontal_align: "left",
          vertical_align: "top",
          width: "auto",
        },
      ],
      rows: [{ dim: "（无维度数据）" }],
    };
  }
  const columns = [
    {
      name: "dim",
      display_name: "维度",
      data_type: "text",
      horizontal_align: "left",
      vertical_align: "top",
      width: FEISHU_COMPARE_TABLE_DIM_WIDTH,
    },
  ];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    columns.push({
      name: `p${i}`,
      display_name: truncateFeishuTableHeader(linkTitleForProduct(c), 20),
      data_type: "lark_md",
      horizontal_align: "left",
      vertical_align: "top",
      width: FEISHU_COMPARE_TABLE_PRODUCT_COL_WIDTH,
    });
  }
  const rows = [];
  for (const e of parentEntries) {
    const dk = queryDimensionKey(e.q);
    const rowLabel = rankCompactLabel(e.q);
    const row = { dim: feishuPlainTableCellText(rowLabel) };
    for (let i = 0; i < cols.length; i++) {
      const ent = i === 0 ? e : maps[i].get(dk);
      const o = ent ? ent.oldRank : null;
      const n = ent ? ent.newRank : null;
      row[`p${i}`] = formatRankTableCellFeishu(o, n);
    }
    rows.push(row);
  }
  const pageSize = Math.min(10, Math.max(1, rows.length));
  return {
    tag: "table",
    page_size: pageSize,
    row_height: "low",
    freeze_first_column: true,
    header_style: headerStyle,
    columns,
    rows,
  };
}

/** 多产品周报中含竞品的折叠块：链 + Markdown 表（飞书原生 table 不可放在 collapsible 内，见开放平台文档） */
function buildFeishuCompareBlockMarkdown(block, dateOld, dateNew) {
  const lines = [];
  if (block.weeklySummaryNote) {
    lines.push(`**备注** · ${block.weeklySummaryNote}`);
    lines.push("");
  }
  lines.push(`**对比区间** · ${dateOld} → ${dateNew}`);
  lines.push("");
  lines.push("**相关链接**");
  lines.push(buildCompareTableLinksSection(block));
  lines.push("");
  lines.push("**下表**为各产品与榜单维度的排名对比（Markdown 表）");
  lines.push("");
  lines.push(buildRankComparisonTableMarkdown(block, { channel: "feishu" }));
  return lines.join("\n");
}

function buildWeWorkCompareTableMarkdown(block, dateOld, dateNew) {
  const lines = [];
  if (block.weeklySummaryNote) {
    lines.push(`**备注** · ${block.weeklySummaryNote}`);
    lines.push("");
  }
  lines.push("**相关链接**");
  lines.push(buildCompareTableLinksSection(block, { wework: true }));
  lines.push("");
  lines.push("**下表**为各产品与榜单维度的排名对比；同行为同一榜单维度；单元格为「旧名次-新名次」");
  lines.push("");
  lines.push(buildRankComparisonTableMarkdown(block, { channel: "wework" }));
  return lines.join("\n");
}

function buildWeWorkCompareBlockMarkdown(block, dateOld, dateNew) {
  const lines = [];
  if (block.weeklySummaryNote) {
    lines.push(`**备注** · ${block.weeklySummaryNote}`);
    lines.push("");
  }
  lines.push(`**对比区间** · ${dateOld} → ${dateNew}`);
  lines.push("");
  lines.push("**相关链接**");
  lines.push(buildCompareTableLinksSection(block, { wework: true }));
  lines.push("");
  lines.push("**下表**为各产品与榜单维度的排名对比（Markdown 表）");
  lines.push("");
  lines.push(buildRankComparisonTableMarkdown(block, { channel: "wework" }));
  return lines.join("\n");
}

/**
 * @param {{ htmlColors?: boolean, feishuSummaryMinimal?: boolean, weWorkIntro?: boolean, dailyTotalBoardsOnly?: boolean }} [opts]
 *   `feishuSummaryMinimal`：飞书「总结」首条专用——无「游戏总榜…有变化产品」标题、无红绿/上升下降说明，仅保留 **上升** / **下降** 与产品行（或兜底列表）。
 *   `weWorkIntro`：企微日报产品行前缀与链接样式，见 buildIntroProductHeadLine
 *   `dailyTotalBoardsOnly`：日报仅 iOS（iPhone）与 Android 游戏总榜两维
 */
function buildTotalBoardChangedIntroMarkdown(productBlocks, opts) {
  const htmlColors = !opts || opts.htmlColors !== false;
  const feishuSummaryMinimal = !!(opts && opts.feishuSummaryMinimal);
  const dailyTotalBoardsOnly = !!(opts && opts.dailyTotalBoardsOnly);
  const introLineOpts = opts || {};
  const parenOpts = { htmlColors, dailyTotalBoardsOnly };
  const qual = productBlocks.filter((b) => productHasGameTotalIntroChange(b, opts));
  const sorted = sortBlocksByLabel(qual);
  if (sorted.length === 0) {
    if (feishuSummaryMinimal && dailyTotalBoardsOnly) {
      return "iOS（iPhone）与 Android 游戏总榜无可用变化摘要。";
    }
    return feishuSummaryMinimal
      ? "游戏总榜无可用变化摘要；其他分榜见**单独**消息。"
      : "**ios / android / iPad** 游戏总榜均无可用变化；其他分榜见**单独**消息或折叠块，按首字母排序。";
  }
  const upLines = [];
  const downLines = [];
  for (const b of sorted) {
    const raw = getGameTotalChangedEntriesForIntro(b, opts);
    const up = [];
    const down = [];
    for (const e of raw) {
      const dir = introRankDirectionForSummary(e.oldRank, e.newRank);
      if (dir === "up") up.push(e);
      else if (dir === "down") down.push(e);
    }
    const head = buildIntroProductHeadLine(b, introLineOpts);
    if (up.length) upLines.push(head + buildIosAndroidParenFromEntries(up, parenOpts));
    if (down.length) downLines.push(head + buildIosAndroidParenFromEntries(down, parenOpts));
  }
  const intro =
    (dailyTotalBoardsOnly
      ? "**游戏总榜（iPhone · Android）** · 有变化产品（按首字母）\n\n"
      : "**游戏总榜（ios / android / iPad）** · 有变化产品（按首字母）\n\n") +
    (htmlColors
      ? "分 **上升** / **下降** 两块；**红（+）**/**绿（−）** 与明细同一套「旧名次 − 新名次」约定；同一产品若各端走势不同会各出现一行。"
      : "分 **上升** / **下降** 两块；（+）/（−）与明细同一套「旧名次 − 新名次」约定；同一产品若各端走势不同会各出现一行。");
  if (upLines.length === 0 && downLines.length === 0) {
    const chunks = sorted.map(
      (b) => buildIntroProductHeadLine(b, introLineOpts) + buildIosAndroidGameTotalParen(b, parenOpts),
    );
    if (feishuSummaryMinimal) {
      return chunks.join("\n");
    }
    return `${intro}\n\n${chunks.join("\n")}`;
  }
  const secUp =
    upLines.length > 0
      ? `\n\n**上升**\n\n${upLines.join("\n")}`
      : "\n\n**上升**\n\n（无）";
  const secDown =
    downLines.length > 0
      ? `\n\n**下降**\n\n${downLines.join("\n")}`
      : "\n\n**下降**\n\n（无）";
  if (feishuSummaryMinimal) {
    const su = upLines.length > 0 ? `**上升**\n\n${upLines.join("\n")}` : `**上升**\n\n（无）`;
    const sd = downLines.length > 0 ? `**下降**\n\n${downLines.join("\n")}` : `**下降**\n\n（无）`;
    return `${su}\n\n${sd}`;
  }
  return intro + secUp + secDown;
}

function apiCacheKey(q, dateStr) {
  return `${q.os}|${q.app_ids[0]}|${q.category}|${q.chart_type_ids[0]}|${dateStr}`;
}

function callCategoryHistoryApiOnce(q, dateStr, token) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const params = new URLSearchParams({
      app_ids: q.app_ids.join(","),
      category: q.category,
      chart_type_ids: q.chart_type_ids.join(","),
      countries: COUNTRY,
      start_date: dateStr,
      end_date: dateStr,
    });

    const options = {
      hostname: SENSORTOWER_API_HOST,
      path: `/v1/${q.os}/category/category_history?${params.toString()}`,
      method: "GET",
      agent: httpsAgent,
      headers: {
        Authorization: `Bearer ${token}`,
        Connection: "close",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        req.setTimeout(0);
        if (res.statusCode && res.statusCode >= 400) {
          console.error(`[WARN] HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
          done(null);
          return;
        }
        try {
          done(JSON.parse(data));
        } catch (e) {
          console.error(`[WARN] Parse error: ${data.slice(0, 200)}`);
          done(null);
        }
      });
    });

    req.on("error", (e) => {
      req.setTimeout(0);
      console.error(`[WARN] Request error: ${e.message}`);
      done(null);
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.setTimeout(0);
      req.destroy();
      console.error(`[WARN] Timeout (${REQUEST_TIMEOUT_MS}ms)`);
      done(null);
    });

    req.end();
  });
}

async function callCategoryHistoryApi(q, dateStr, token) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const data = await callCategoryHistoryApiOnce(q, dateStr, token);
    if (data !== null) return data;
    if (attempt < MAX_RETRIES) {
      const backoff = Math.min(2500 * 2 ** (attempt - 1), 45000);
      console.error(`       → 第 ${attempt}/${MAX_RETRIES} 次失败，${Math.round(backoff / 1000)}s 后重试...`);
      await sleep(backoff);
    }
  }
  return null;
}

async function fetchRanksForDate(sqlDb, dateStr, flatQueries, token, apiCache) {
  const results = {};
  const pending = [];

  for (const item of flatQueries) {
    const { internal_name, q } = item;
    const key = queryResultKey(internal_name, q);
    const ck = apiCacheKey(q, dateStr);

    let rank = null;
    let fromDb = false;

    const stmt = sqlDb.prepare(
      `SELECT rank FROM app_ranks WHERE internal_name = ? AND country = ? AND platform = ? AND device = ? AND chart_type = ? AND category = ? AND app_id = ? AND rank_date = ?`
    );
    stmt.bind([
      internal_name,
      COUNTRY,
      q.os,
      q.device,
      q.chart_type_ids[0],
      q.category,
      q.app_ids[0],
      dateStr,
    ]);
    if (stmt.step()) {
      const row = stmt.get();
      rank = row[0];
      fromDb = true;
    }
    stmt.free();

    if (fromDb) {
      process.stdout.write(` [DB] ${internal_name} ${q.device}/${q.category_name} `);
      console.log(rank != null ? `#${rank}` : "未上榜");
      results[key] = rank;
      continue;
    }

    if (apiCache.has(ck)) {
      rank = apiCache.get(ck);
      process.stdout.write(` [缓存] ${internal_name} ${q.device}/${q.category_name} `);
      console.log(rank != null ? `#${rank}` : "未上榜");
      results[key] = rank;
      continue;
    }

    pending.push({ item, key, ck, internal_name, q });
  }

  const groups = new Map();
  for (const p of pending) {
    const gk = categoryHistoryBatchKey(p.q);
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(p);
  }

  let batchSeq = 0;
  for (const plist of groups.values()) {
    const uniqApps = [];
    const seenApp = new Set();
    for (const p of plist) {
      const aid = String(p.q.app_ids[0]);
      if (!seenApp.has(aid)) {
        seenApp.add(aid);
        uniqApps.push(aid);
      }
    }

    const qTemplate = plist[0].q;
    for (const chunk of chunkArray(uniqApps, CATEGORY_HISTORY_APP_IDS_BATCH)) {
      if (batchSeq++ > 0) await sleep(BETWEEN_QUERIES_MS);
      const qBatch = { ...qTemplate, app_ids: chunk };
      const chunkSet = new Set(chunk);
      process.stdout.write(
        ` [API batch ${chunk.length} app_ids] ${qTemplate.os} ${qTemplate.device}/${qTemplate.category_name || qTemplate.category} `
      );
      const data = await callCategoryHistoryApi(qBatch, dateStr, token);
      console.log(data ? "OK" : "FAIL");

      for (const p of plist) {
        if (!chunkSet.has(String(p.q.app_ids[0]))) continue;
        const rank = data ? getRankFromData(data, p.q, dateStr) : null;
        apiCache.set(p.ck, rank);
        results[p.key] = rank;
        process.stdout.write(` [API] ${p.internal_name} ${p.q.device}/${p.q.category_name} `);
        console.log(rank != null ? `#${rank}` : "未上榜");
        sqlDb.run(
          `INSERT OR REPLACE INTO app_ranks (internal_name, product_code, display_name, country, platform, device, chart_type, category, category_name, app_id, rank_date, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.internal_name,
            p.item.product_code || "",
            p.item.display_name || "",
            COUNTRY,
            p.q.os,
            p.q.device,
            p.q.chart_type_ids[0],
            p.q.category,
            p.q.category_name,
            p.q.app_ids[0],
            dateStr,
            rank,
          ]
        );
      }
    }
  }

  return results;
}

function chunkText(s, maxLen) {
  if (!s) return [""];
  const out = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + maxLen));
    i += maxLen;
  }
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 同一 category_history 请求：同 os、device、category、chart_type（不含 app_id） */
function categoryHistoryBatchKey(q) {
  return `${q.os}|${q.device}|${q.category}|${q.chart_type_ids[0]}`;
}

/**
 * rank_changes.country（如 🇺🇸 美国）或两位 ISO → 两位国家码；无法识别时 US（对齐 Python _country_to_code）
 */
function countryToCode(country) {
  if (country == null || String(country).trim() === "") return "US";
  const s = String(country).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const lower = s.toLowerCase();
  if (lower.includes("美国") || lower === "usa" || lower.includes("united states") || s.includes("🇺🇸"))
    return "US";
  if (lower.includes("英国") || s.includes("🇬🇧") || lower === "uk") return "GB";
  if (lower.includes("日本") || s.includes("🇯🇵") || lower === "jp") return "JP";
  if (lower.includes("中国") || s.includes("🇨🇳") || lower === "cn") return "CN";
  if (lower.includes("韩国") || s.includes("🇰🇷") || lower === "kr") return "KR";
  return "US";
}

function sensortowerOverviewBase() {
  return (process.env.SENSORTOWER_OVERVIEW_BASE || SENSORTOWER_OVERVIEW_BASE_DEFAULT).replace(/\/+$/, "");
}

/**
 * 与 Python _sensortower_overview_url 一致：
 * - 有 project_id：`{base}/overview/{project_id}/{app_id}?country={code}`
 * - 无：`{base}/overview/{app_id}?country={code}`
 */
function sensorTowerOverviewUrl(appId, countryRaw, projectId) {
  const base = sensortowerOverviewBase();
  const code = countryToCode(countryRaw);
  const app = String(appId).trim();
  if (!app) return null;
  const pid = projectId && String(projectId).trim();
  /** 与 scripts/send_sensortower_weekly_push.py `_sensortower_overview_url`、generate_top5_overview 一致；country 已由 countryToCode 规范为 ASCII 码 */
  const q = `country=${code}`;
  if (pid) {
    return `${base}/overview/${pid}/${app}?${q}`;
  }
  return `${base}/overview/${app}?${q}`;
}

/**
 * @param {{ omitProjectId?: boolean }} [opts]
 *   `omitProjectId`：企微 Markdown 与游戏大盘周报脚本一致，仅使用 `overview/{app_id}?country=`，不带 project 段（转发后链接更稳定）。
 */
function sensorTowerUrlForIds(ids, opts) {
  if (!ids) return null;
  const country = ids.country != null && ids.country !== "" ? ids.country : COUNTRY;
  const omitProject = !!(opts && opts.omitProjectId);
  const projectId = omitProject
    ? ""
    : (ids.st_overview_parent_id && String(ids.st_overview_parent_id).trim()) ||
      (process.env.ST_CHINA_OVERVIEW_PARENT_ID && String(process.env.ST_CHINA_OVERVIEW_PARENT_ID).trim()) ||
      (process.env.SENSORTOWER_OVERVIEW_PROJECT_ID && String(process.env.SENSORTOWER_OVERVIEW_PROJECT_ID).trim()) ||
      "";

  if (ids.apple_app_id) {
    return sensorTowerOverviewUrl(String(ids.apple_app_id).trim(), country, projectId);
  }
  if (ids.google_app_id) {
    return sensorTowerOverviewUrl(String(ids.google_app_id).trim(), country, projectId);
  }
  return null;
}

/** 美国区 App Store 应用页 */
function appleStoreUrl(appleId) {
  return `https://apps.apple.com/us/app/id${String(appleId).trim()}`;
}

/** Google Play 美国区详情页 */
function googlePlayUrl(packageName) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(String(packageName).trim())}&gl=US`;
}

/** 飞书 markdown 链接文案中避免破坏 [] 解析 */
function escapeMdLinkLabel(s) {
  return String(s).replace(/\]/g, "﹞").replace(/\[/g, "﹝");
}

/** 飞书 plain_text 标题最长约 56 字；优先保留末尾括号（ios/android/iPad 环比） */
function feishuTruncateWithOptionalParen(base, paren) {
  const max = 56;
  const b = String(base || "").trim() || "产品";
  const p = paren ? String(paren) : "";
  if (!p) return b.length <= max ? b : `${b.slice(0, max - 1)}…`;
  const full = `${b}${p}`;
  if (full.length <= max) return full;
  const room = max - p.length;
  if (room < 4) return `${b.slice(0, max - 1)}…`;
  return `${b.slice(0, room - 1)}…${p}`;
}

/** 折叠面板标题：内部名（含重名后缀）；含竞品数量；游戏名后接 ios/android/iPad 括号环比 */
function feishuPanelTitleFromProduct(block, opts) {
  let t = linkTitleForProduct(block).trim() || "产品";
  const n = (block.competitorPanels || []).length;
  if (n > 0 && !(opts && opts.omitCompetitorCount)) t = `${t} · ${n}竞品`;
  const paren = buildIosAndroidGameTotalParen(block, { plainText: true });
  return feishuTruncateWithOptionalParen(t, paren);
}

/** 竞品折叠标题：竞品 · 名（ios…，android…） */
function feishuCompetitorPanelTitle(c) {
  const base = `竞品 · ${linkTitleForProduct(c).trim() || "竞品"}`;
  const paren = buildIosAndroidGameTotalParen(c, { plainText: true });
  return feishuTruncateWithOptionalParen(base, paren);
}

/** @param {'summary'|'standalone'} role 总结 / 单独（不再使用 Daily/Weekly 文案） */
function buildFeishuNoteFooterElements(role) {
  const cn = role === "standalone" ? "单独" : "总结";
  return [
    { tag: "hr" },
    {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: `SensorTower US 免费榜 · ${cn} · ${new Date().toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}`,
        },
      ],
    },
  ];
}

/** 「单独」消息顶部：置顶产品目录（与下方折叠标题一致，含本品与嵌套竞品） */
function buildFeishuProductDirectoryMarkdown(sortedBlocks) {
  const lines = ["**📌 产品目录**（首字母序，与下方折叠块标题一致）", ""];
  for (const block of sortedBlocks) {
    lines.push(`- ${feishuPanelTitleFromProduct(block)}`);
    const comps = block.competitorPanels || [];
    for (const c of comps) {
      lines.push(`  - ${feishuCompetitorPanelTitle(c)}`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {{ flatCompetitors?: boolean, compareTable?: boolean, dateOld?: string, dateNew?: string }} [opts]
 */
function buildFeishuCollapsiblePanelElements(sortedBlocks, opts) {
  const flatCompetitors = !!(opts && opts.flatCompetitors);
  const compareTable = !!(opts && opts.compareTable);
  const dateOld = opts && opts.dateOld;
  const dateNew = opts && opts.dateNew;
  const out = [];
  if (!sortedBlocks || sortedBlocks.length === 0) {
    out.push({
      tag: "div",
      text: { tag: "plain_text", content: "（无数据）" },
    });
    return out;
  }
  const rankExpanded =
    String(process.env.FEISHU_RANK_DETAIL_EXPANDED || "").trim() === "1" ||
    String(process.env.FEISHU_RANK_DETAIL_EXPANDED || "").toLowerCase() === "true";
  const panelShell = {
    tag: "collapsible_panel",
    expanded: rankExpanded,
    background_color: "grey",
    header: {
      title: { tag: "plain_text", content: "" },
      vertical_align: "center",
      icon: {
        tag: "standard_icon",
        token: "down-small-ccm_outlined",
        color: "",
        size: "16px 16px",
      },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: {
      color: "grey",
      corner_radius: "5px",
    },
    vertical_spacing: "8px",
    padding: "8px",
    elements: [],
  };
  const nestedPanelShell = {
    tag: "collapsible_panel",
    expanded: false,
    background_color: "grey",
    header: {
      title: { tag: "plain_text", content: "" },
      vertical_align: "center",
      icon: {
        tag: "standard_icon",
        token: "down-small-ccm_outlined",
        color: "",
        size: "16px 16px",
      },
      icon_position: "right",
      icon_expanded_angle: -180,
    },
    border: {
      color: "grey",
      corner_radius: "5px",
    },
    vertical_spacing: "8px",
    padding: "8px",
    elements: [],
  };
  for (let i = 0; i < sortedBlocks.length; i++) {
    const block = sortedBlocks[i];
    const comps = block.competitorPanels || [];
    if (compareTable && comps.length > 0 && dateOld && dateNew) {
      out.push({
        ...panelShell,
        header: {
          ...panelShell.header,
          title: {
            tag: "plain_text",
            content: feishuPanelTitleFromProduct(block, { omitCompetitorCount: true }),
          },
        },
        elements: [{ tag: "markdown", content: buildFeishuCompareBlockMarkdown(block, dateOld, dateNew) }],
      });
      continue;
    }
    if (flatCompetitors) {
      const mainTitle = feishuPanelTitleFromProduct(block, { omitCompetitorCount: true });
      out.push({
        ...panelShell,
        header: {
          ...panelShell.header,
          title: { tag: "plain_text", content: mainTitle },
        },
        elements: [{ tag: "markdown", content: buildRankPanelMarkdownBody(block) }],
      });
      for (const c of comps) {
        out.push({
          ...panelShell,
          header: {
            ...panelShell.header,
            title: { tag: "plain_text", content: feishuCompetitorPanelTitle(c) },
          },
          elements: [{ tag: "markdown", content: buildRankPanelMarkdownBody(c) }],
        });
      }
      continue;
    }
    const panelElements = [];
    panelElements.push({ tag: "markdown", content: buildRankPanelMarkdownBody(block) });
    for (const c of comps) {
      panelElements.push({
        ...nestedPanelShell,
        header: {
          ...nestedPanelShell.header,
          title: { tag: "plain_text", content: feishuCompetitorPanelTitle(c) },
        },
        elements: [{ tag: "markdown", content: buildRankPanelMarkdownBody(c) }],
      });
    }
    out.push({
      ...panelShell,
      header: {
        ...panelShell.header,
        title: {
          tag: "plain_text",
          content: feishuPanelTitleFromProduct(block),
        },
      },
      elements: panelElements,
    });
  }
  return out;
}

/**
 * 日报总结正文（游戏总榜摘要）：与周报「单独」、折叠块、对比表等逻辑解耦。
 * @param {{ wework?: boolean }} [opts] 企微为 true 时不着色
 */
function buildDailySummaryBodyMarkdown(productBlocks, opts) {
  const wework = !!(opts && opts.wework);
  return buildTotalBoardChangedIntroMarkdown(productBlocks, {
    feishuSummaryMinimal: true,
    htmlColors: !wework,
    weWorkIntro: wework,
    dailyTotalBoardsOnly: true,
  });
}

/** 飞书/企微头栏：统计范围说明（日报与周报共用） */
const US_FREE_CHART_SCOPE_MARKDOWN = "**统计口径** · 仅统计各维度入围前 500 名的本公司产品。";

/** 飞书日报：仅一条总结；无 note 页脚；标题固定不含日期 */
function buildFeishuDailySummaryCard(dateOld, dateNew, summaryMarkdown) {
  const elements = [];
  elements.push({
    tag: "markdown",
    content: [
      "**📍 美国 US** · 免费榜（iOS/Android）",
      "",
      US_FREE_CHART_SCOPE_MARKDOWN,
      "",
      `**日环比** · ${dateOld} → ${dateNew}`,
    ].join("\n"),
  });
  elements.push({ tag: "hr" });
  elements.push({ tag: "markdown", content: summaryMarkdown });
  const title = `公司自有产品 · SensorTower US 免费榜 · 日总结`;
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: title },
      },
      elements,
    },
  };
}

/** 飞书第 1 条：总结（游戏总榜 ios/android/iPad 摘要等） */
function buildFeishuWeeklySummaryCard(dateOld, dateNew, productBlocks) {
  const elements = [];
  elements.push({
    tag: "markdown",
    content: [
      "**📍 美国 US** · 免费榜（iPhone / iPad / Android）",
      "",
      US_FREE_CHART_SCOPE_MARKDOWN,
      "",
      `**环比** · ${dateOld} → ${dateNew}`,
    ].join("\n"),
  });
  elements.push({ tag: "hr" });
  elements.push({
    tag: "markdown",
    content: buildTotalBoardChangedIntroMarkdown(productBlocks, { feishuSummaryMinimal: true }),
  });

  const title = `公司自有产品 SensorTower US 免费榜排名变化 · 总结`;
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: title },
      },
      elements,
    },
  };
}

/**
 * 飞书「单独」：置顶产品目录 + 各维度折叠明细
 * @param {{ minimal?: boolean, compareTable?: boolean }} [opts] `minimal=true`（单产品推送）：不要总结、也不要目录与说明，仅折叠块 + 页脚；`compare-table` 时有竞品则整卡为对比表
 */
function buildFeishuWeeklyDetailCard(dateOld, dateNew, productBlocks, opts) {
  const minimal = !!(opts && opts.minimal);
  const compareTable = !!(opts && opts.compareTable);
  const sortedBlocks = sortBlocksByLabel(productBlocks);
  const singleParentWithComps =
    sortedBlocks.length === 1 && (sortedBlocks[0].competitorPanels || []).length > 0;
  const elements = [];
  if (!minimal) {
    elements.push({
      tag: "markdown",
      content: buildFeishuProductDirectoryMarkdown(sortedBlocks),
    });
    elements.push({ tag: "hr" });
    if (compareTable && singleParentWithComps) {
      elements.push({
        tag: "markdown",
        content: "**📋 各维度对比**（表格；行=同榜维度，列=各产品）",
      });
    } else {
      elements.push({
        tag: "markdown",
        content:
          "**📋 各维度明细**（单独）\n\n按**产品内部名首字母**排序；点击标题栏展开**快捷链接**与各维度排名。",
      });
    }
  }
  if (compareTable && singleParentWithComps) {
    elements.push({
      tag: "markdown",
      content: buildFeishuCompareTableIntroMarkdown(sortedBlocks[0], dateOld, dateNew),
    });
    elements.push(buildFeishuRankComparisonTableElement(sortedBlocks[0]));
    elements.push(...buildFeishuNoteFooterElements("standalone"));
    const mainName = String(linkTitleForProduct(sortedBlocks[0]) || "").trim() || "产品";
    let title = `${mainName} · SensorTower US 免费榜 · 排名对比 ${dateOld}～${dateNew}`;
    if (title.length > 200) title = `${title.slice(0, 197)}…`;
    return {
      msg_type: "interactive",
      card: {
        config: { wide_screen_mode: true, enable_forward: true },
        header: {
          template: "turquoise",
          title: { tag: "plain_text", content: title },
        },
        elements,
      },
    };
  }

  const flatCompetitors =
    minimal &&
    !(compareTable && sortedBlocks.some((b) => (b.competitorPanels || []).length > 0));
  elements.push(
    ...buildFeishuCollapsiblePanelElements(sortedBlocks, {
      flatCompetitors,
      compareTable,
      dateOld,
      dateNew,
    }),
  );
  elements.push(...buildFeishuNoteFooterElements("standalone"));

  const title = minimal
    ? `公司自有产品 SensorTower US 免费榜排名变化 ${dateOld}～${dateNew} · 明细`
    : `公司自有产品 SensorTower US 免费榜排名变化 ${dateOld}～${dateNew} · 单独`;
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true, enable_forward: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: title },
      },
      elements,
    },
  };
}

/** 仅日报一条总结卡；周报请用 buildFeishuWeeklySummaryCard / buildFeishuWeeklyDetailCard */
function buildFeishuCard(dateOld, dateNew, productBlocks, reportKind) {
  if (reportKind === "daily") {
    const body = buildDailySummaryBodyMarkdown(productBlocks, { wework: false });
    return buildFeishuDailySummaryCard(dateOld, dateNew, body);
  }
  throw new Error("飞书已拆成「总结」与「单独」两条，请使用 buildFeishuWeeklySummaryCard / buildFeishuWeeklyDetailCard");
}

/** 企业微信机器人 markdown 单条上限 4096 字节；预留序号头，默认按 3800 切分正文 */
const WEWORK_MARKDOWN_BODY_BYTES_DEFAULT = 3800;

function getWeWorkMarkdownBodyMaxBytes() {
  const n = parseInt(String(process.env.WEWORK_MARKDOWN_MAX_BYTES || "").trim(), 10);
  if (Number.isFinite(n) && n >= 800 && n <= 4096) return n;
  return WEWORK_MARKDOWN_BODY_BYTES_DEFAULT;
}

function splitUtf8ByMaxBytes(text, maxBytes) {
  const out = [];
  let buf = "";
  for (const ch of text) {
    const trial = buf + ch;
    if (Buffer.byteLength(trial, "utf8") > maxBytes) {
      if (buf) out.push(buf);
      buf = ch;
    } else {
      buf = trial;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 按行累加字节切分；超长单行再按字符切 */
function splitMarkdownForWeWorkBytes(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return [text];
  const chunks = [];
  let cur = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > maxBytes) {
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      chunks.push(...splitUtf8ByMaxBytes(line, maxBytes));
      continue;
    }
    const joiner = cur ? "\n" : "";
    const cand = cur + joiner + line;
    if (Buffer.byteLength(cand, "utf8") <= maxBytes) {
      cur = cand;
    } else {
      if (cur) chunks.push(cur);
      cur = line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function buildWeWorkMarkdown(dateOld, dateNew, productBlocks, reportKind, opts) {
  const skipSummary = !!(opts && opts.skipSummary);
  const kind = reportKind === "daily" ? "daily" : "weekly";
  const lines = [];
  if (kind === "daily") {
    lines.push(`**公司自有产品 · SensorTower US 免费榜 ${dateOld}～${dateNew}**`);
  } else {
    lines.push(`## 公司自有产品 · SensorTower US 免费榜 ${dateOld}～${dateNew}`);
  }
  lines.push("");
  lines.push(
    kind === "daily"
      ? "**美国 US** · 免费榜（iOS/Android）"
      : "**美国 US** · 免费榜（iPhone / iPad / Android）",
  );
  lines.push("");
  lines.push(US_FREE_CHART_SCOPE_MARKDOWN);
  lines.push("");
  lines.push(`${kind === "daily" ? "**日环比**" : "**环比**"} · ${dateOld} → ${dateNew}`);
  lines.push("");
  if (kind === "daily") {
    const body = buildDailySummaryBodyMarkdown(productBlocks, { wework: true });
    lines.push(body);
    return lines.join("\n").trim();
  }

  if (kind === "weekly" && skipSummary) {
    lines.push("---");
    lines.push("");
  } else {
    lines.push("---");
    lines.push("");
    lines.push(buildTotalBoardChangedIntroMarkdown(productBlocks, { htmlColors: false }));
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  if (kind === "weekly" && opts && opts.summaryOnly) {
    lines.push(
      `US Free · 总结 · ${new Date().toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })}`,
    );
    return lines.join("\n").trim();
  }

  const sortedBlocks = sortBlocksByLabel(productBlocks);
  const compareTable = !!(opts && opts.compareTable);
  const singleParentWithComps =
    sortedBlocks.length === 1 && (sortedBlocks[0].competitorPanels || []).length > 0;

  if (compareTable && singleParentWithComps) {
    lines.push("**各维度对比**（表格）");
    lines.push("");
    lines.push(buildWeWorkCompareTableMarkdown(sortedBlocks[0], dateOld, dateNew));
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(
      skipSummary
        ? `US Free · 明细 · ${new Date().toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}`
        : `US Free · 总结+单独 · ${new Date().toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          })}`,
    );
    return lines.join("\n").trim();
  }

  lines.push(
    skipSummary
      ? "**各维度明细**（单产品；无折叠，以标题分层）"
      : "**单独 · 各维度明细**（首字母；无折叠，以标题分层）",
  );
  lines.push("");
  if (!sortedBlocks.length) {
    lines.push("（无数据）");
  } else {
    for (const block of sortedBlocks) {
      if (compareTable && (block.competitorPanels || []).length > 0) {
        lines.push(
          formatWeWorkMarkdownH3Product(block, skipSummary ? { omitCompetitorCount: true } : undefined),
        );
        lines.push("");
        lines.push(buildWeWorkCompareBlockMarkdown(block, dateOld, dateNew));
        lines.push("");
        lines.push("---");
        lines.push("");
        continue;
      }
      lines.push(
        formatWeWorkMarkdownH3Product(block, skipSummary ? { omitCompetitorCount: true } : undefined),
      );
      lines.push("");
      lines.push(buildRankPanelMarkdownBody(block, { channel: "wework" }));
      lines.push("");
      const comps = block.competitorPanels || [];
      for (const c of comps) {
        lines.push(skipSummary ? formatWeWorkMarkdownH3Competitor(c) : formatWeWorkMarkdownH4Competitor(c));
        lines.push("");
        lines.push(buildRankPanelMarkdownBody(c, { channel: "wework" }));
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
  }
  lines.push(
    skipSummary
      ? `US Free · 明细 · ${new Date().toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        })}`
      : `US Free · 总结+单独 · ${new Date().toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        })}`,
  );
  return lines.join("\n").trim();
}

function httpsPathWithQuery(url) {
  return url.pathname + (url.search || "");
}

function sendWeWorkMarkdownMessage(webhookUrl, markdownContent) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const body = JSON.stringify({
      msgtype: "markdown",
      markdown: { content: markdownContent },
    });
    const options = {
      hostname: url.hostname,
      path: httpsPathWithQuery(url),
      port: 443,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.errcode === 0) resolve(json);
          else {
            const err = new Error(`WeWork error: ${data.slice(0, 400)}`);
            err.weworkJson = json;
            reject(err);
          }
        } catch (e) {
          reject(new Error(`WeWork parse: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("WeWork timeout"));
    });
    req.write(body);
    req.end();
  });
}

/** 超长则拆多条顺序发送；序号 `[1/3]` 仅在多条时出现 */
async function sendWeWorkWeekly(webhookUrl, dateOld, dateNew, productBlocks, reportKind, opts) {
  const hardMax = 4096;
  const bodyMax = Math.min(getWeWorkMarkdownBodyMaxBytes(), hardMax - 120);
  const full = buildWeWorkMarkdown(dateOld, dateNew, productBlocks, reportKind, opts);
  let parts = splitMarkdownForWeWorkBytes(full, bodyMax);
  if (parts.length === 0) parts = [""];
  console.log(
    `企业微信将发送 ${parts.length} 条 markdown（单条正文切分 ≤ ${bodyMax} 字节，含序号后 ≤ ${hardMax}）`,
  );
  for (let i = 0; i < parts.length; i++) {
    const idx = `[${i + 1}/${parts.length}]`;
    const content = parts.length > 1 ? `${idx}\n\n${parts[i]}` : parts[i];
    const blen = Buffer.byteLength(content, "utf8");
    if (blen > hardMax) {
      throw new Error(
        `企业微信单条 ${blen} 字节仍超过 ${hardMax}，请调低 WEWORK_MARKDOWN_MAX_BYTES（当前正文上限 ${bodyMax}）`,
      );
    }
    await sendWeWorkMarkdownMessage(webhookUrl, content);
    console.log(`企业微信 ${i + 1}/${parts.length} 已发送（${blen} 字节）`);
    if (i < parts.length - 1) await sleep(250);
  }
}

function sendFeishuMessage(webhookUrl, cardPayload) {
  walkFeishuInteractivePayload(cardPayload);
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const body = JSON.stringify(cardPayload);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      port: 443,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0 || json.StatusCode === 0) resolve(json);
          else {
            const err = new Error(`Feishu error: ${data.slice(0, 400)}`);
            err.feishuJson = json;
            reject(err);
          }
        } catch (e) {
          reject(new Error(`Feishu parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Feishu timeout"));
    });
    req.write(body);
    req.end();
  });
}

/** 单条交互卡片；遇 11232 则退避重试 */
async function sendFeishuMessageWithRetry(webhookUrl, cardPayload, label) {
  let attempt = 0;
  const maxAttempts = 5;
  while (attempt < maxAttempts) {
    try {
      await sendFeishuMessage(webhookUrl, cardPayload);
      console.log(label ? `飞书已发送（${label}）` : "飞书已发送");
      return;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const code11232 =
        msg.includes("11232") || (e.feishuJson && e.feishuJson.code === 11232);
      attempt++;
      if (code11232 && attempt < maxAttempts) {
        const wait = Math.min(8000 * attempt, 60000);
        console.error(`飞书频率限制 (11232)，${wait / 1000}s 后重试 (${attempt}/${maxAttempts})…`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

/**
 * `--daily`：1 条（仅总结）。周报：默认 2 条（总结 → 单独）；`opts.skipSummary`（如 `--only-product`）时仅 1 条，且仅折叠明细（无目录与说明）。
 */
async function sendFeishuWeeklyCard(webhookUrl, dateOld, dateNew, productBlocks, productCount, lineCount, reportKind, opts) {
  const skipSummary = !!(opts && opts.skipSummary);
  const summaryOnly = !!(opts && opts.summaryOnly);
  if (reportKind === "daily") {
    console.log(`飞书将发送 1 条消息（仅总结，${productBlocks.length} 个产品块）`);
    const card = buildFeishuCard(dateOld, dateNew, productBlocks, "daily");
    await sendFeishuMessageWithRetry(webhookUrl, card, "总结");
    return;
  }

  if (summaryOnly && !skipSummary) {
    console.log(`飞书将发送 1 条消息（仅总结，无单独；${productBlocks.length} 个产品块）`);
    const summaryCard = buildFeishuWeeklySummaryCard(dateOld, dateNew, productBlocks);
    await sendFeishuMessageWithRetry(webhookUrl, summaryCard, "总结");
    return;
  }

  if (skipSummary) {
    const ct = !!(opts && opts.compareTable);
    const hasComps =
      productBlocks.length === 1 && (productBlocks[0].competitorPanels || []).length > 0;
    console.log(
      ct && hasComps
        ? `飞书将发送 1 条消息（产品与竞品对比表，无总结；1 个产品块）`
        : `飞书将发送 1 条消息（仅折叠明细，无总结；${productBlocks.length} 个产品块）`,
    );
    const detailCard = buildFeishuWeeklyDetailCard(dateOld, dateNew, productBlocks, {
      minimal: true,
      compareTable: !!(opts && opts.compareTable),
    });
    const sendLabel = ct && hasComps ? "对比表" : "明细";
    await sendFeishuMessageWithRetry(webhookUrl, detailCard, sendLabel);
    return;
  }

  console.log(`飞书将发送 2 条消息（总结 + 单独，${productBlocks.length} 个产品块）`);
  const summaryCard = buildFeishuWeeklySummaryCard(dateOld, dateNew, productBlocks);
  await sendFeishuMessageWithRetry(webhookUrl, summaryCard, "总结");
  await sleep(800);
  const detailCard = buildFeishuWeeklyDetailCard(dateOld, dateNew, productBlocks, {
    compareTable: !!(opts && opts.compareTable),
  });
  await sendFeishuMessageWithRetry(webhookUrl, detailCard, "单独");
}

/**
 * 从 appid_us.json + 本地 DB 两期 rank 重建 mergedBlocks（不调 SensorTower API）
 * @param {{ skipCompetitors?: boolean, onlyProduct?: string|null, dailyTotalBoardsOnly?: boolean }} [opts]
 * @returns {{ mergedBlocks: Array, lineCount: number }}
 */
async function loadMergedBlocksFromDatabase(DATE_OLD, DATE_NEW, opts) {
  const skipCompetitors = !!(opts && opts.skipCompetitors);
  const dailyTotalBoardsOnly = !!(opts && opts.dailyTotalBoardsOnly);
  const onlyProduct = opts && opts.onlyProduct ? String(opts.onlyProduct).trim() : "";
  let list = JSON.parse(fs.readFileSync(APPID_US_JSON, "utf-8"));
  if (onlyProduct) {
    list = list.filter((row) => String(row.internal_name) === onlyProduct);
    if (list.length === 0) {
      throw new Error(`appid_us.json 中无 internal_name「${onlyProduct}」`);
    }
  }

  let flatQueries = [];
  for (const row of list) {
    const qs = expandQueriesForApp(row, { skipCompetitors, dailyTotalBoardsOnly });
    if (qs.length === 0) continue;
    flatQueries.push(...qs);
  }
  const beforeDedupe = flatQueries.length;
  flatQueries = dedupeFlatQueries(flatQueries);
  if (flatQueries.length < beforeDedupe) {
    console.log(`维度去重：${beforeDedupe} → ${flatQueries.length}（去掉重复 internal_name+同榜同包）\n`);
  }

  if (flatQueries.length === 0) {
    throw new Error(
      dailyTotalBoardsOnly
        ? "没有可展开的维度（日报仅游戏总榜：需 apple_app_id 与/或 google_app_id，且 summary 或 fallback 能展开）"
        : "没有可展开的维度，请检查 appid_us.json",
    );
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在: ${DB_PATH}，请先跑完整周报脚本`);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  function loadRanksForDate(dateStr) {
    const map = {};
    const stmt = db.prepare(
      `SELECT internal_name, platform, device, chart_type, category, app_id, rank FROM app_ranks WHERE country = ? AND rank_date = ?`
    );
    stmt.bind([COUNTRY, dateStr]);
    while (stmt.step()) {
      const row = stmt.get();
      const internalName = row[0];
      const q = {
        os: row[1],
        device: row[2],
        chart_type_ids: [row[3]],
        category: row[4],
        app_ids: [row[5]],
      };
      const k = queryResultKey(internalName, q);
      map[k] = row[6];
    }
    stmt.free();
    return map;
  }

  const oldRanks = loadRanksForDate(DATE_OLD);
  const newRanks = loadRanksForDate(DATE_NEW);
  db.close();

  const byProduct = new Map();
  for (const item of flatQueries) {
    const k = queryResultKey(item.internal_name, item.q);
    const o = oldRanks[k] !== undefined ? oldRanks[k] : null;
    const n = newRanks[k] !== undefined ? newRanks[k] : null;
    const line = formatRankCompactLine(item.q, o, n);
    const lineFeishu = formatRankCompactLineFeishu(item.q, o, n);
    const gk = productGroupKey(item);
    if (!byProduct.has(gk)) {
      byProduct.set(gk, {
        internal_name: item.internal_name,
        product_code: item.product_code,
        display_name: item.display_name,
        apple_app_id: item.apple_app_id,
        google_app_id: item.google_app_id,
        country: item.country || COUNTRY,
        st_overview_parent_id: item.st_overview_parent_id || null,
        weekly_note: item.us_free_weekly_note || null,
        competitor_parent: item.competitorParent != null ? item.competitorParent : null,
        lines: [],
        feishuLines: [],
        rankEntries: [],
      });
    }
    const bucket = byProduct.get(gk);
    bucket.lines.push(line);
    bucket.feishuLines.push(lineFeishu);
    bucket.rankEntries.push({ q: item.q, oldRank: o, newRank: n });
  }

  if (byProduct.size === 0) {
    throw new Error(`库中无 ${DATE_OLD} / ${DATE_NEW} 的排名数据，请先跑完整脚本写入 app_ranks`);
  }

  const lineCount = [...byProduct.values()].reduce((s, x) => s + x.lines.length, 0);
  const productBlocks = [];
  for (const info of byProduct.values()) {
    productBlocks.push({
      internalName: info.internal_name,
      productCode: info.product_code,
      displayName: info.display_name,
      ids: {
        apple_app_id: info.apple_app_id,
        google_app_id: info.google_app_id,
        country: info.country,
        st_overview_parent_id: info.st_overview_parent_id,
      },
      rankLines: info.feishuLines,
      plainRankLines: info.lines,
      rankEntries: info.rankEntries,
      weeklySummaryNote: info.weekly_note || null,
      competitorParent: info.competitor_parent || null,
    });
  }

  let mergedBlocks = mergeCompetitorBlocksIntoParents(productBlocks);
  assignInternalNameLabels(mergedBlocks);
  if (onlyProduct) {
    const fb = filterMergedBlocksToSingleProduct(mergedBlocks, onlyProduct);
    if (!fb.length) {
      throw new Error(`合并后未找到本品「${onlyProduct}」（需与 appid_us 的 internal_name 一致）`);
    }
    mergedBlocks = fb;
  }
  return { mergedBlocks, lineCount };
}

/**
 * 仅从本地 DB 读取两期 rank，重建简报并推送飞书（不调 SensorTower API）
 */
async function feishuOnlyMain() {
  const raw = process.argv.slice(2).filter((a) => a !== "--feishu-only");
  const run = parseRunFlags(raw);
  const { DATE_OLD, DATE_NEW } = resolveDateRangeFromArgs(run.rest, { daily: run.daily });
  const reportKind = reportKindFromFlags(run);

  loadEnv(path.join(ROOT, ".env"));
  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) {
    console.error("缺少 FEISHU_WEBHOOK_URL");
    process.exit(1);
  }

  let mergedBlocks;
  let lineCount;
  try {
    const r = await loadMergedBlocksFromDatabase(DATE_OLD, DATE_NEW, {
      skipCompetitors: run.noCompetitors,
      onlyProduct: run.onlyProduct,
      dailyTotalBoardsOnly: run.daily,
    });
    mergedBlocks = r.mergedBlocks;
    lineCount = r.lineCount;
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  console.log(
    `仅飞书推送：${DATE_OLD} → ${DATE_NEW}，折叠块 ${mergedBlocks.length} 个${run.onlyProduct ? `（仅 ${run.onlyProduct}）` : ""}${run.noCompetitors ? "（无竞品）" : "（含竞品已并入本品）"}${run.daily ? "（日报仅游戏总榜 iPhone+Android）" : ""}，维度 ${lineCount}`,
  );

  await sendFeishuWeeklyCard(webhook, DATE_OLD, DATE_NEW, mergedBlocks, mergedBlocks.length, lineCount, reportKind, {
    skipSummary: !!run.onlyProduct,
    compareTable: !!run.compareTable,
    summaryOnly: !!run.summaryOnly,
  });
  console.log("飞书推送完成");
}

/** 仅推送企业微信（依赖本地 DB，逻辑同 --feishu-only） */
async function weworkOnlyMain() {
  const raw = process.argv.slice(2).filter((a) => !ARG_WEEWORK_ONLY.has(a));
  const run = parseRunFlags(raw);
  const { DATE_OLD, DATE_NEW } = resolveDateRangeFromArgs(run.rest, { daily: run.daily });
  const reportKind = reportKindFromFlags(run);

  loadEnv(path.join(ROOT, ".env"));
  const webhook = process.env.WEWORK_WEBHOOK_URL;
  if (!webhook) {
    console.error("缺少 WEWORK_WEBHOOK_URL");
    process.exit(1);
  }

  let mergedBlocks;
  let lineCount;
  try {
    const r = await loadMergedBlocksFromDatabase(DATE_OLD, DATE_NEW, {
      skipCompetitors: run.noCompetitors,
      onlyProduct: run.onlyProduct,
      dailyTotalBoardsOnly: run.daily,
    });
    mergedBlocks = r.mergedBlocks;
    lineCount = r.lineCount;
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }

  console.log(
    `仅企业微信推送：${DATE_OLD} → ${DATE_NEW}，产品块 ${mergedBlocks.length} 个${run.onlyProduct ? `（仅 ${run.onlyProduct}）` : ""}${run.noCompetitors ? "（无竞品）" : ""}${run.daily ? "（日报仅游戏总榜 iPhone+Android）" : ""}，维度 ${lineCount}`,
  );

  try {
    await sendWeWorkWeekly(webhook, DATE_OLD, DATE_NEW, mergedBlocks, reportKind, {
      skipSummary: !!run.onlyProduct,
      compareTable: !!run.compareTable,
      summaryOnly: !!run.summaryOnly,
    });
    console.log("企业微信推送完成");
  } catch (e) {
    console.error("企业微信推送失败:", e.message || e);
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes("--feishu-only")) {
    await feishuOnlyMain();
    return;
  }
  if (argvHasWeworkOnly()) {
    await weworkOnlyMain();
    return;
  }

  const argv = process.argv.slice(2).filter((a) => a !== "--no-feishu" && a !== "--no-wework");
  const noFeishu = process.argv.includes("--no-feishu");
  const noWework = process.argv.includes("--no-wework");
  const run = parseRunFlags(argv);
  const { DATE_OLD, DATE_NEW } = resolveDateRangeFromArgs(run.rest, { daily: run.daily });
  const reportKind = reportKindFromFlags(run);

  if (run.weekly) {
    console.warn("[周报] 双周流程已弱化，仅作兼容；默认已改为日报总结。勿传 --weekly 即走日报。");
  }

  loadEnv(path.join(ROOT, ".env"));
  const token = process.env.SENSORTOWER_API_TOKEN;
  if (!token) {
    console.error("缺少 SENSORTOWER_API_TOKEN");
    process.exit(1);
  }

  let list = JSON.parse(fs.readFileSync(APPID_US_JSON, "utf-8"));
  if (run.onlyProduct) {
    const n = String(run.onlyProduct).trim();
    list = list.filter((row) => String(row.internal_name) === n);
    if (list.length === 0) {
      console.error(`未找到 internal_name 为「${n}」的产品（appid_us.json）`);
      process.exit(1);
    }
    console.log(`仅产品：${n}（含竞品维度）\n`);
  }

  let flatQueries = [];
  let skipped = 0;
  for (const row of list) {
    const qs = expandQueriesForApp(row, {
      skipCompetitors: run.noCompetitors,
      dailyTotalBoardsOnly: run.daily,
    });
    if (qs.length === 0) {
      skipped++;
      continue;
    }
    flatQueries.push(...qs);
  }
  const beforeDedupe = flatQueries.length;
  flatQueries = dedupeFlatQueries(flatQueries);
  if (flatQueries.length < beforeDedupe) {
    console.log(`维度去重：${beforeDedupe} → ${flatQueries.length}`);
  }

  if (run.daily) {
    const tz = String(process.env.US_FREE_DAILY_CALENDAR_TZ || "Asia/Shanghai").trim() || "Asia/Shanghai";
    console.log(`日期：日环比 ${DATE_OLD} → ${DATE_NEW}（相邻两日；日历时区 ${tz}；**日报仅 iOS/Android 游戏总榜**）`);
  } else {
    console.log(`日期：上上周日 ${DATE_OLD} → 上周日 ${DATE_NEW}`);
  }
  console.log(
    `展开维度条数：${flatQueries.length}（跳过无 summary 或无维度的产品：${skipped}${run.noCompetitors ? "；已跳过竞品" : ""}）\n`,
  );

  if (flatQueries.length === 0) {
    console.error("没有可查询的维度，请检查 appid_us.json 中 us_free_category_ranking_summary");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS app_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      internal_name TEXT NOT NULL,
      product_code TEXT,
      display_name TEXT,
      country VARCHAR(8) NOT NULL,
      platform VARCHAR(16) NOT NULL,
      device VARCHAR(16) NOT NULL,
      chart_type VARCHAR(64) NOT NULL,
      category VARCHAR(64) NOT NULL,
      category_name VARCHAR(128) NOT NULL,
      app_id VARCHAR(256) NOT NULL,
      rank_date DATE NOT NULL,
      rank INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(internal_name, platform, device, chart_type, category, app_id, rank_date)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      summary_text TEXT NOT NULL,
      product_count INTEGER,
      line_count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  const apiCache = new Map();

  console.log(`=== ${DATE_OLD} ===`);
  const oldRanks = await fetchRanksForDate(db, DATE_OLD, flatQueries, token, apiCache);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  console.log(`\n=== ${DATE_NEW} ===`);
  const newRanks = await fetchRanksForDate(db, DATE_NEW, flatQueries, token, apiCache);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));

  const byProduct = new Map();
  for (const item of flatQueries) {
    const k = queryResultKey(item.internal_name, item.q);
    const o = oldRanks[k] !== undefined ? oldRanks[k] : null;
    const n = newRanks[k] !== undefined ? newRanks[k] : null;
    const line = formatRankCompactLine(item.q, o, n);
    const lineFeishu = formatRankCompactLineFeishu(item.q, o, n);
    const gk = productGroupKey(item);
    if (!byProduct.has(gk)) {
      byProduct.set(gk, {
        internal_name: item.internal_name,
        product_code: item.product_code,
        display_name: item.display_name,
        apple_app_id: item.apple_app_id,
        google_app_id: item.google_app_id,
        country: item.country || COUNTRY,
        st_overview_parent_id: item.st_overview_parent_id || null,
        weekly_note: item.us_free_weekly_note || null,
        competitor_parent: item.competitorParent != null ? item.competitorParent : null,
        lines: [],
        feishuLines: [],
        rankEntries: [],
      });
    }
    const bucket = byProduct.get(gk);
    bucket.lines.push(line);
    bucket.feishuLines.push(lineFeishu);
    bucket.rankEntries.push({ q: item.q, oldRank: o, newRank: n });
  }

  const productBlocks = [];
  for (const info of byProduct.values()) {
    productBlocks.push({
      internalName: info.internal_name,
      productCode: info.product_code,
      displayName: info.display_name,
      ids: {
        apple_app_id: info.apple_app_id,
        google_app_id: info.google_app_id,
        country: info.country,
        st_overview_parent_id: info.st_overview_parent_id,
      },
      rankLines: info.feishuLines,
      plainRankLines: info.lines,
      rankEntries: info.rankEntries,
      weeklySummaryNote: info.weekly_note || null,
      competitorParent: info.competitor_parent || null,
    });
  }
  let mergedBlocks = mergeCompetitorBlocksIntoParents(productBlocks);
  assignInternalNameLabels(mergedBlocks);
  if (run.onlyProduct) {
    const fb = filterMergedBlocksToSingleProduct(mergedBlocks, run.onlyProduct);
    if (!fb.length) {
      console.error(`合并后未找到本品「${run.onlyProduct}」`);
      process.exit(1);
    }
    mergedBlocks = fb;
  }
  const summaryLines = [];
  for (const block of mergedBlocks) {
    const ids = block.ids;
    summaryLines.push(`【${linkTitleForProduct(block)}】`);
    if (block.weeklySummaryNote) summaryLines.push(`备注：${block.weeklySummaryNote}`);
    const st = sensorTowerUrlForIds(ids);
    if (st) summaryLines.push(`SensorTower: ${st}`);
    if (ids.apple_app_id) summaryLines.push(`Apple Store: ${appleStoreUrl(ids.apple_app_id)}`);
    if (ids.google_app_id) summaryLines.push(`Google Play: ${googlePlayUrl(ids.google_app_id)}`);
    summaryLines.push(...(block.plainRankLines || []));
    const comps = block.competitorPanels || [];
    for (const c of comps) {
      summaryLines.push("");
      summaryLines.push(`—— 竞品：${linkTitleForProduct(c)} ——`);
      const cid = c.ids || {};
      const cst = sensorTowerUrlForIds(cid);
      if (cst) summaryLines.push(`SensorTower: ${cst}`);
      if (cid.apple_app_id) summaryLines.push(`Apple Store: ${appleStoreUrl(cid.apple_app_id)}`);
      if (cid.google_app_id) summaryLines.push(`Google Play: ${googlePlayUrl(cid.google_app_id)}`);
      const { totalP, restP } = partitionRankLinesByGameTotal(c);
      summaryLines.push("【游戏总榜】");
      if (totalP.length) summaryLines.push(...totalP);
      else summaryLines.push("（无游戏总榜维度）");
      if (restP.length) {
        summaryLines.push("【其他分榜】");
        summaryLines.push(...restP);
      }
    }
    summaryLines.push("");
  }
  const summaryText = (run.daily ? "【总结·日环比】\n" : "") + summaryLines.join("\n").trim();
  const lineCount = flatQueries.length;

  db.run(`INSERT INTO weekly_summaries (date_from, date_to, summary_text, product_count, line_count) VALUES (?, ?, ?, ?, ?)`, [
    DATE_OLD,
    DATE_NEW,
    summaryText,
    mergedBlocks.length,
    lineCount,
  ]);
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  db.close();

  const outTxt = path.join(
    ROOT,
    "data",
    run.daily ? `us_free_appid_daily_${DATE_OLD}_${DATE_NEW}.txt` : `us_free_appid_weekly_${DATE_OLD}_${DATE_NEW}.txt`,
  );
  fs.writeFileSync(outTxt, summaryText + "\n", "utf-8");
  console.log(`\n简报已写: ${outTxt}`);
  console.log(`数据库: ${DB_PATH}`);

  const webhook = process.env.FEISHU_WEBHOOK_URL;
  if (!noFeishu) {
    if (!webhook) {
      console.warn("未配置 FEISHU_WEBHOOK_URL，跳过飞书（可用 --no-feishu 消除本提示）");
    } else {
      try {
        await sendFeishuWeeklyCard(webhook, DATE_OLD, DATE_NEW, mergedBlocks, mergedBlocks.length, lineCount, reportKind, {
          skipSummary: !!run.onlyProduct,
          compareTable: !!run.compareTable,
          summaryOnly: !!run.summaryOnly,
        });
        console.log("飞书推送完成");
      } catch (e) {
        console.error("飞书推送失败:", e.message);
      }
    }
  }

  const weworkHook = process.env.WEWORK_WEBHOOK_URL;
  if (!noWework) {
    if (!weworkHook) {
      console.warn("未配置 WEWORK_WEBHOOK_URL，跳过企业微信（可用 --no-wework 消除本提示）");
    } else {
      try {
        await sendWeWorkWeekly(weworkHook, DATE_OLD, DATE_NEW, mergedBlocks, reportKind, {
          skipSummary: !!run.onlyProduct,
          compareTable: !!run.compareTable,
          summaryOnly: !!run.summaryOnly,
        });
        console.log("企业微信推送完成");
      } catch (e) {
        console.error("企业微信推送失败:", e.message);
      }
    }
  }
}

/** 自测：node scripts/us_free_appid_weekly_rank_changes.js --verify-urls */
async function verifySampleUrls() {
  loadEnv(path.join(ROOT, ".env"));
  const sample = { apple_app_id: "1492978794", google_app_id: "sudoku.puzzle.free.game.brain" };
  const rows = [
    ["SensorTower (iOS)", sensorTowerUrlForIds({ apple_app_id: sample.apple_app_id })],
    ["SensorTower (Android)", sensorTowerUrlForIds({ google_app_id: sample.google_app_id })],
    ["App Store", appleStoreUrl(sample.apple_app_id)],
    ["Google Play", googlePlayUrl(sample.google_app_id)],
  ];
  const https = require("https");
  for (const [label, url] of rows) {
    if (!url) {
      console.log(`${label}: (无 URL)`);
      continue;
    }
    const ok = await new Promise((resolve) => {
      const opts = {
        timeout: 20000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; sensortower-weekly/1.0; +https://github.com/) Chrome/120.0.0.0 Safari/537.36",
        },
      };
      const req = https.get(url, opts, (res) => {
        res.resume();
        const code = res.statusCode || 0;
        resolve(code >= 200 && code < 400);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    console.log(`${ok ? "OK" : "FAIL"} ${label}\n  ${url}`);
  }
}

if (process.argv.includes("--verify-urls")) {
  verifySampleUrls()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
