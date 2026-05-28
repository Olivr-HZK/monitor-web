/**
 * 飞书「产品与竞品对比」表格 + 快捷链接（与 us_free_appid_weekly_rank_changes.js 中 compare-table 一致）
 * 供 arrow_madness_daily_competitors 等脚本复用，避免 require 主脚本触发 CLI。
 */

const COUNTRY = "US";
const SENSORTOWER_OVERVIEW_BASE_DEFAULT = "https://app.sensortower-china.com";

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

function sensorTowerOverviewUrl(appId, countryRaw, projectId) {
  const base = sensortowerOverviewBase();
  const code = countryToCode(countryRaw);
  const app = String(appId).trim();
  if (!app) return null;
  const pid = projectId && String(projectId).trim();
  const q = `country=${code}`;
  if (pid) {
    return `${base}/overview/${pid}/${app}?${q}`;
  }
  return `${base}/overview/${app}?${q}`;
}

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

function appleStoreUrl(appleId) {
  return `https://apps.apple.com/us/app/id${String(appleId).trim()}`;
}

function googlePlayUrl(packageName) {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(String(packageName).trim())}&gl=US`;
}

function escapeMdLinkLabel(s) {
  return String(s).replace(/\]/g, "﹞").replace(/\[/g, "﹝");
}

/**
 * 展示用名称：优先商店/对外名称（display_name）；重名区分时保留 feishuLabel（如 internal_name1）
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

/** 与 us_free rankCompactLabel 一致；平台名 iOS / iPad / Android */
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

/** 飞书卡片对比表：维度列宽 + 各产品列最小宽度（px），减少长数字一行被省略号截断 */
const FEISHU_COMPARE_TABLE_DIM_WIDTH = "160px";
const FEISHU_COMPARE_TABLE_PRODUCT_COL_WIDTH = "160px";

function truncateFeishuTableHeader(s, maxLen) {
  const t = String(s || "").trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(1, maxLen - 1))}…`;
}

function feishuPlainTableCellText(s) {
  return String(s == null ? "" : s).replace(/\r?\n/g, " ");
}

/** 名称与 us_free 一致：ST 链在「游戏名」上；Apple / Google 另列（无「本品」「竞品」前缀） */
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

/**
 * @param {object} block 与 us_free compare-table 相同结构
 * @param {string} dateOld
 * @param {string} dateNew
 */
function buildFeishuCompareTableInteractiveCard(block, dateOld, dateNew) {
  const productName = String(linkTitleForProduct(block) || "").trim() || "产品";
  let title = `${productName} · SensorTower US 免费榜 · 排名对比 ${dateOld}～${dateNew}`;
  if (title.length > 200) title = `${title.slice(0, 197)}…`;
  const elements = [
    {
      tag: "markdown",
      content: buildFeishuCompareTableIntroMarkdown(block, dateOld, dateNew),
    },
    buildFeishuRankComparisonTableElement(block),
    ...buildFeishuNoteFooterElements("standalone"),
  ];
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

module.exports = {
  queryDimensionKey,
  rankCompactLabel,
  buildRankEntryMap,
  buildFeishuCompareTableIntroMarkdown,
  buildFeishuRankComparisonTableElement,
  buildFeishuCompareTableInteractiveCard,
  buildCompareTableLinksSection,
  linkTitleForProduct,
};
