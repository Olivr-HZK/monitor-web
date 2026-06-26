#!/usr/bin/env node
/**
 * Single-game SensorTower profile workflow.
 *
 * Usage:
 *   node scripts/single_game_profile.js "Block Blast"
 *   node scripts/single_game_profile.js "Block Blast" --country WW --start-date 2026-05-04 --end-date 2026-06-02
 *   node scripts/single_game_profile.js "Block Blast" --dry-run
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");
const {
  slugifyName,
  buildIdentityFromCandidates,
  parseAppleSearchResults,
  parseGooglePlaySearchResults,
  parseLocalDbRows,
  filterLocalRowsByQuery,
  localSearchTokens,
  mergeCandidateSources,
  buildMetricTargets,
  parseSalesReportEstimates,
  parseActiveUsers,
  latestRankFromCategoryHistory,
  defaultDateWindow,
  buildProfile,
  renderMarkdownProfile,
  selectFeishuWebhookEnv,
  buildFeishuProfileCard,
} = require("./single_game_profile_core.js");

const ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..", "..", "..");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "public", "休闲游戏检测", "sensortower_单游戏画像");
const DEFAULT_CACHE = path.join(DEFAULT_OUT_DIR, "identity_cache.json");
const ST_API_HOST = process.env.SENSORTOWER_API_HOST || "api.sensortower.com";
const ST_API_BASE = `https://${ST_API_HOST}`;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env"));
loadEnvFile(path.join(REPO_ROOT, ".env"));

function parseArgs(argv) {
  const opts = {
    country: "WW",
    startDate: null,
    endDate: null,
    outDir: DEFAULT_OUT_DIR,
    cachePath: DEFAULT_CACHE,
    dryRun: false,
    useMockIds: false,
    sendFeishu: false,
    feishuWebhookEnv: "",
  };
  const parts = [];
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--country") opts.country = argv[++i];
    else if (arg === "--start-date") opts.startDate = argv[++i];
    else if (arg === "--end-date") opts.endDate = argv[++i];
    else if (arg === "--out-dir") opts.outDir = path.resolve(argv[++i]);
    else if (arg === "--cache") opts.cachePath = path.resolve(argv[++i]);
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--use-mock-ids") opts.useMockIds = true;
    else if (arg === "--send-feishu") opts.sendFeishu = true;
    else if (arg === "--feishu-webhook-env") opts.feishuWebhookEnv = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      parts.push(arg);
    }
  }
  opts.gameName = parts.join(" ").trim();
  if (!opts.startDate || !opts.endDate) {
    const range = defaultDateWindow();
    opts.startDate = opts.startDate || range.startDate;
    opts.endDate = opts.endDate || range.endDate;
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/single_game_profile.js "<game name>" [options]

Options:
  --country <code>       Country code. Defaults to WW.
  --start-date <date>    YYYY-MM-DD. Defaults to last completed 30-day window.
  --end-date <date>      YYYY-MM-DD. Defaults to yesterday UTC.
  --out-dir <path>       Output directory.
  --cache <path>         Identity cache path.
  --dry-run              Do not require SensorTower token; write mock metric payload.
  --use-mock-ids         Use built-in Block Blast ids when query resembles Block Blast.
  --send-feishu          Send the generated profile to Feishu Game God webhook.
  --feishu-webhook-env   Override webhook env key. Defaults to game-god fallbacks.
`);
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function sqliteRows(dbPath, sql) {
  if (!fs.existsSync(dbPath)) return [];
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8", stdio: "pipe" }).trim();
    return out ? JSON.parse(out) : [];
  } catch (_) {
    return [];
  }
}

function sqlEscape(value) {
  return String(value || "").replace(/'/g, "''");
}

function searchLocalDatabases(gameName) {
  const tokens = localSearchTokens(gameName);
  const buildWhere = (columns) => {
    if (!tokens.length) return "1=0";
    return tokens
      .map((token) => {
        const like = `%${sqlEscape(token)}%`;
        return `(${columns.map((column) => `${column} LIKE '${like}'`).join(" OR ")})`;
      })
      .join(" AND ");
  };
  const dbs = [
    path.join(REPO_ROOT, "public", "sensortower_applist.db"),
    path.join(REPO_ROOT, "public", "sensortower_top100.db"),
  ];
  const rows = [];

  rows.push(
    ...sqliteRows(
      dbs[0],
      `SELECT app_id, os, name, publisher_name, categories FROM app_metadata WHERE ${buildWhere(["name", "humanized_name"])} LIMIT 20`
    )
  );
  rows.push(
    ...sqliteRows(
      dbs[1],
      `SELECT app_id, os, name, publisher_name, categories FROM app_metadata WHERE ${buildWhere(["name", "humanized_name"])} LIMIT 20`
    )
  );
  rows.push(
    ...sqliteRows(
      dbs[1],
      `SELECT app_id, 'ios' AS os, app_name, '' AS publisher_name, chart_type_display AS categories FROM apple_top100 WHERE ${buildWhere(["app_name"])} GROUP BY app_id LIMIT 20`
    )
  );
  rows.push(
    ...sqliteRows(
      dbs[1],
      `SELECT app_id, 'android' AS os, app_name, '' AS publisher_name, chart_type_display AS categories FROM android_top100 WHERE ${buildWhere(["app_name"])} GROUP BY app_id LIMIT 20`
    )
  );
  return parseLocalDbRows(filterLocalRowsByQuery(gameName, rows));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.setTimeout(90000, () => {
      req.destroy(new Error("request timed out"));
    });
  });
}

async function fetchJson(url, headers = {}) {
  const text = await httpGet(url, headers);
  return JSON.parse(text);
}

function httpPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Feishu request timed out"));
    });
    req.write(body);
    req.end();
  });
}

function resolveFeishuWebhook(opts) {
  if (opts.feishuWebhookEnv) {
    const value = process.env[opts.feishuWebhookEnv] ? String(process.env[opts.feishuWebhookEnv]).trim() : "";
    return { key: opts.feishuWebhookEnv, value };
  }
  return selectFeishuWebhookEnv(process.env);
}

async function sendFeishuProfile(profile, opts) {
  const selected = resolveFeishuWebhook(opts);
  if (!selected.value) {
    throw new Error(
      `未配置飞书 webhook。请设置 FEISHU_GAME_GOD_WEBHOOK_URL、FEISHU_WEBHOOK_URL_GAME_GOD 或 FEISHU_WEBHOOK_URL`
    );
  }
  const payload = buildFeishuProfileCard(profile);
  const result = await httpPostJson(selected.value, payload);
  let parsed = null;
  try {
    parsed = JSON.parse(result.body || "{}");
  } catch (_) {}
  const ok =
    result.status === 200 &&
    parsed &&
    (parsed.code === 0 || parsed.StatusCode === 0 || parsed.status_code === 0);
  if (!ok) {
    const detail = (result.body || "").slice(0, 500);
    throw new Error(`[飞书] 发送失败 env=${selected.key} HTTP=${result.status} resp=${detail}`);
  }
  return selected.key;
}

function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return search.toString();
}

async function searchApple(gameName, country) {
  const url = `https://itunes.apple.com/search?${buildQuery({
    term: gameName,
    entity: "software",
    country: country === "WW" ? "US" : country,
    limit: 10,
  })}`;
  const data = await fetchJson(url);
  return parseAppleSearchResults(data);
}

async function searchGooglePlay(gameName, country) {
  const url = `https://play.google.com/store/search?${buildQuery({
    q: gameName,
    c: "apps",
    gl: country === "WW" ? "US" : country,
    hl: "en",
  })}`;
  const html = await httpGet(url, {
    "User-Agent": "Mozilla/5.0 (compatible; monitor-web-single-game/1.0)",
  });
  return parseGooglePlaySearchResults(html);
}

function mockCandidates(gameName) {
  if (!/block\s*blast/i.test(gameName)) return { ios: [], android: [] };
  return {
    ios: [
      {
        os: "ios",
        appId: "1617391485",
        name: "Block Blast!",
        publisher: "Hungry Studio",
        categories: ["Games", "Puzzle"],
        ratingCount: 6151864,
        source: "mock_block_blast",
      },
    ],
    android: [
      {
        os: "android",
        appId: "com.block.juggle",
        name: "Block Blast!",
        publisher: "HungryStudio",
        categories: ["Games", "Puzzle"],
        ratingCount: 4740191,
        source: "mock_block_blast",
      },
    ],
  };
}

function cacheKey(gameName, country) {
  return `${slugifyName(gameName)}|${String(country || "").toUpperCase()}`;
}

async function resolveIdentity(opts, warnings) {
  const cache = readJsonIfExists(opts.cachePath, {});
  const key = cacheKey(opts.gameName, opts.country);
  if (cache[key]) {
    return { identity: cache[key], fromCache: true };
  }

  const localCandidates = searchLocalDatabases(opts.gameName);
  let candidates = {
    ios: [...localCandidates.ios],
    android: [...localCandidates.android],
  };

  if (opts.useMockIds) {
    const mocked = mockCandidates(opts.gameName);
    candidates = {
      ios: [...candidates.ios, ...mocked.ios],
      android: [...candidates.android, ...mocked.android],
    };
  } else {
    const [iosResult, androidResult] = await Promise.allSettled([
      searchApple(opts.gameName, opts.country),
      searchGooglePlay(opts.gameName, opts.country),
    ]);
    if (iosResult.status === "fulfilled") candidates.ios.push(...iosResult.value);
    else warnings.push(`Apple Search failed: ${iosResult.reason.message}`);
    if (androidResult.status === "fulfilled") candidates.android.push(...androidResult.value);
    else warnings.push(`Google Play search failed: ${androidResult.reason.message}`);
  }

  candidates = {
    ios: mergeCandidateSources(candidates.ios),
    android: mergeCandidateSources(candidates.android),
  };
  const identity = buildIdentityFromCandidates(opts.gameName, candidates);
  if (!identity.iosAppIds.length && !identity.androidAppIds.length) {
    throw new Error(`未能从游戏名解析出可信 app id: ${opts.gameName}`);
  }

  cache[key] = {
    ...identity,
    cachedAt: new Date().toISOString(),
  };
  writeJson(opts.cachePath, cache);
  return { identity: cache[key], fromCache: false };
}

function authToken() {
  return process.env.SENSORTOWER_API_TOKEN || process.env.SENSOR_TOWER_API_TOKEN || "";
}

async function stJson(pathname, params, apiCalls, token) {
  const url = `${ST_API_BASE}${pathname}?${buildQuery({ ...params, auth_token: token })}`;
  apiCalls.push({ name: pathname.split("/").pop(), url: url.replace(/auth_token=[^&]+/, "auth_token=***") });
  return fetchJson(url);
}

async function fetchLiveProfileData(opts, identity, warnings) {
  const token = authToken();
  if (!token) {
    throw new Error("缺少 SENSORTOWER_API_TOKEN；可先用 --dry-run 验证链路");
  }
  const apiCalls = [];
  const targets = buildMetricTargets(identity);

  let salesRows = [];
  let activeUserRows = [];
  const rankings = [];

  for (const target of targets) {
    const commonPeriod = {
      app_ids: target.appIds,
      countries: opts.country,
      start_date: opts.startDate,
      end_date: opts.endDate,
    };

    try {
      const sales = await stJson(`/v1/${target.os}/sales_report_estimates`, {
        ...commonPeriod,
        date_granularity: "daily",
      }, apiCalls, token);
      salesRows.push(...parseSalesReportEstimates(sales));
    } catch (e) {
      warnings.push(`sales_report_estimates ${target.os} failed: ${e.message}`);
    }

    try {
      const active = await stJson(`/v1/${target.os}/usage/active_users`, {
        ...commonPeriod,
        time_period: "day",
      }, apiCalls, token);
      activeUserRows.push(...parseActiveUsers(active));
    } catch (e) {
      warnings.push(`active_users ${target.os} failed: ${e.message}`);
    }
  }

  const iosId = identity.iosAppIds && identity.iosAppIds[0];
  if (iosId) {
    const rankQueries = [
      { category: "7012", categoryName: "Games/Puzzle", chartType: "topfreeapplications", device: "iphone" },
      { category: "7003", categoryName: "Games/Casual", chartType: "topfreeapplications", device: "iphone" },
      { category: "6014", categoryName: "Games", chartType: "topfreeapplications", device: "iphone" },
      { category: "0", categoryName: "Overall", chartType: "topfreeapplications", device: "iphone" },
      { category: "7012", categoryName: "Games/Puzzle", chartType: "topfreeipadapplications", device: "ipad" },
    ];
    for (const q of rankQueries) {
      try {
        const data = await stJson("/v1/ios/category/category_history", {
          app_ids: iosId,
          countries: opts.country === "WW" ? "US" : opts.country,
          category: q.category,
          chart_type_ids: q.chartType,
          start_date: opts.startDate,
          end_date: opts.endDate,
        }, apiCalls, token);
        const latestRank = latestRankFromCategoryHistory(data, {
          appId: iosId,
          country: opts.country === "WW" ? "US" : opts.country,
          category: q.category,
          chartType: q.chartType,
          endDate: opts.endDate,
        });
        rankings.push({
          os: "ios",
          device: q.device,
          category: q.category,
          categoryName: q.categoryName,
          chartType: q.chartType,
          latestRank,
          series: data,
        });
      } catch (e) {
        warnings.push(`category_history ${q.device}/${q.categoryName} failed: ${e.message}`);
      }
    }
  }

  warnings.push("website visits endpoint unavailable: App Analysis OpenAPI does not expose Web Insights visits.");
  warnings.push("time spent is not fetched in the first live workflow unless a verified unified app id is available.");

  return { salesRows, activeUserRows, rankings, apiCalls };
}

function mockProfileData() {
  return {
    salesRows: [
      { appId: "mock", country: "WW", date: "2026-05-04", downloads: 900000, revenue: 300 },
      { appId: "mock", country: "WW", date: "2026-05-05", downloads: 850000, revenue: 380 },
      { appId: "mock", country: "WW", date: "2026-05-06", downloads: 870000, revenue: 320 },
    ],
    activeUserRows: [
      { appId: "mock", country: "WW", date: "2026-05-04", activeUsers: 1200000 },
      { appId: "mock", country: "WW", date: "2026-05-05", activeUsers: 1180000 },
      { appId: "mock", country: "WW", date: "2026-05-06", activeUsers: 1210000 },
    ],
    rankings: [
      { os: "ios", device: "iphone", category: "7012", categoryName: "Games/Puzzle", chartType: "topfreeapplications", latestRank: 1 },
      { os: "ios", device: "ipad", category: "7012", categoryName: "Games/Puzzle", chartType: "topfreeipadapplications", latestRank: 3 },
    ],
    apiCalls: [
      { name: "apple_search", url: "dry-run" },
      { name: "google_play_search", url: "dry-run" },
      { name: "sales_report_estimates", url: "dry-run" },
      { name: "active_users", url: "dry-run" },
      { name: "category_history", url: "dry-run" },
    ],
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.gameName) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }
  fs.mkdirSync(opts.outDir, { recursive: true });

  const warnings = [];
  const { identity, fromCache } = await resolveIdentity(opts, warnings);
  if (fromCache) warnings.push("identity loaded from cache");

  const liveData = opts.dryRun
    ? mockProfileData()
    : await fetchLiveProfileData(opts, identity, warnings);
  if (opts.dryRun) {
    warnings.push("dry-run mode: metric values are mock data; identity resolution still uses cache/local DB/search unless --use-mock-ids is set.");
  }

  const profile = buildProfile({
    now: new Date().toISOString(),
    identity,
    period: { startDate: opts.startDate, endDate: opts.endDate, country: opts.country },
    ...liveData,
    warnings,
  });
  const slug = slugifyName(identity.canonicalName || opts.gameName);
  const jsonPath = path.join(opts.outDir, `game_profile_${slug}.json`);
  const mdPath = path.join(opts.outDir, `game_profile_${slug}.md`);
  writeJson(jsonPath, { ...profile, markdownPath: mdPath, jsonPath });
  fs.writeFileSync(mdPath, renderMarkdownProfile(profile), "utf8");

  console.log(`已生成 JSON: ${jsonPath}`);
  console.log(`已生成 Markdown: ${mdPath}`);
  console.log(`识别: ${identity.canonicalName} / iOS=${(identity.iosAppIds || []).join(",") || "N/A"} / Android=${(identity.androidAppIds || []).join(",") || "N/A"}`);
  if (opts.sendFeishu) {
    const envKey = await sendFeishuProfile(profile, opts);
    console.log(`[飞书] 发送成功 env=${envKey}`);
  }
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
