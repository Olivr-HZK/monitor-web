const DEFAULT_CONFIDENCE = {
  high: 0.8,
  medium: 0.55,
};

function slugifyName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSet(name) {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

function jaccardSimilarity(a, b) {
  const aa = tokenSet(a);
  const bb = tokenSet(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  const union = new Set([...aa, ...bb]).size;
  return union ? overlap / union : 0;
}

function nameSimilarity(query, candidateName) {
  const q = normalizeName(query);
  const c = normalizeName(candidateName);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.92;
  return jaccardSimilarity(q, c);
}

function confidenceFromScore(score) {
  if (score >= DEFAULT_CONFIDENCE.high) return "high";
  if (score >= DEFAULT_CONFIDENCE.medium) return "medium";
  return "low";
}

function isGameCategory(categories) {
  return (categories || []).some((category) => /game|puzzle|casual|arcade|益智|游戏/i.test(String(category)));
}

function scoreCandidate(query, candidate) {
  const nameScore = nameSimilarity(query, candidate.name || candidate.title || "");
  const reviewCount = Number(candidate.ratingCount || candidate.reviewCount || candidate.userRatingCount || 0);
  const reviewScore = reviewCount > 0 ? Math.min(1, Math.log10(reviewCount + 1) / 7) : 0;
  const categoryScore = isGameCategory(candidate.categories || candidate.genres) ? 1 : 0;
  const publisherScore = candidate.publisher || candidate.developer ? 0.5 : 0;
  const score = nameScore * 0.68 + reviewScore * 0.17 + categoryScore * 0.1 + publisherScore * 0.05;
  return Math.max(0, Math.min(1, score));
}

function selectBestCandidate(query, candidates) {
  const scored = (candidates || [])
    .map((candidate) => {
      const score = scoreCandidate(query, candidate);
      return {
        ...candidate,
        score: Number(score.toFixed(4)),
        confidence: confidenceFromScore(score),
      };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function buildIdentityFromCandidates(query, candidatesByPlatform) {
  const ios = selectBestCandidate(query, candidatesByPlatform.ios || []);
  const android = selectBestCandidate(query, candidatesByPlatform.android || []);
  if (!ios && !android) {
    return {
      query,
      canonicalName: query,
      publisher: "",
      unifiedAppId: null,
      iosAppIds: [],
      androidAppIds: [],
      confidence: "low",
      platforms: {},
      warnings: ["No credible app candidates found."],
    };
  }

  const primary = ios || android;
  const scores = [ios, android].filter(Boolean).map((x) => x.score);
  const averageScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;

  const platforms = {};
  if (ios) {
    platforms.ios = {
      appId: String(ios.appId),
      name: ios.name,
      publisher: ios.publisher || ios.developer || "",
      score: ios.score,
      confidence: ios.confidence,
      source: ios.source || "candidate_search",
    };
  }
  if (android) {
    platforms.android = {
      appId: String(android.appId),
      name: android.name,
      publisher: android.publisher || android.developer || "",
      score: android.score,
      confidence: android.confidence,
      source: android.source || "candidate_search",
    };
  }

  return {
    query,
    canonicalName: primary.name || query,
    publisher: primary.publisher || primary.developer || "",
    unifiedAppId: null,
    iosAppIds: ios ? [String(ios.appId)] : [],
    androidAppIds: android ? [String(android.appId)] : [],
    confidence: confidenceFromScore(averageScore),
    platforms,
    warnings: [],
  };
}

function parseAppleSearchResults(data) {
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results
    .filter((item) => item && item.trackId && item.trackName)
    .map((item) => ({
      os: "ios",
      appId: String(item.trackId),
      name: String(item.trackName || ""),
      publisher: String(item.sellerName || item.artistName || ""),
      categories: Array.isArray(item.genres) ? item.genres.map(String) : [],
      ratingCount: Number(item.userRatingCount || item.averageUserRatingForCurrentVersionCount || 0) || 0,
      source: "apple_search",
    }));
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseGooglePlaySearchResults(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["'][^"']*\/store\/apps\/details\?id=([^"'&]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = re.exec(String(html || "")))) {
    const anchor = match[0] || "";
    const appId = decodeURIComponent(match[1]);
    if (!appId || seen.has(appId)) continue;
    seen.add(appId);
    const aria = anchor.match(/\baria-label=["']([^"']+)["']/i);
    const name = aria ? decodeHtmlEntities(aria[1]).trim() : stripTags(match[2]);
    out.push({
      os: "android",
      appId,
      name,
      publisher: "",
      categories: ["Games"],
      ratingCount: 0,
      source: "google_play_search",
    });
  }
  return out;
}

function parseCategories(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value == null || value === "") return [];
  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch (_) {}
  return raw
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLocalDbRows(rows) {
  const out = { ios: [], android: [] };
  for (const row of rows || []) {
    if (!row || !row.app_id) continue;
    const os = String(row.os || row.platform || "").toLowerCase().includes("android") ? "android" : "ios";
    const candidate = {
      os,
      appId: String(row.app_id),
      name: String(row.name || row.app_name || row.humanized_name || row.app_id),
      publisher: String(row.publisher_name || row.publisher || ""),
      categories: parseCategories(row.categories || row.category || row.chart_type_display),
      ratingCount: Number(row.rating_count || row.review_count || 0) || 0,
      source: "local_db",
    };
    out[os].push(candidate);
  }
  return out;
}

function filterLocalRowsByQuery(query, rows) {
  return (rows || []).filter((row) => {
    const name = row.name || row.app_name || row.humanized_name || "";
    return nameSimilarity(query, name) >= 0.9;
  });
}

function localSearchTokens(query) {
  return String(query || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 6);
}

function mergeCandidateSources(candidates) {
  const byKey = new Map();
  for (const candidate of candidates || []) {
    if (!candidate || !candidate.appId || !candidate.os) continue;
    const key = `${candidate.os}|${candidate.appId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        os: candidate.os,
        appId: String(candidate.appId),
        name: candidate.name || "",
        publisher: candidate.publisher || "",
        categories: [...new Set(candidate.categories || [])],
        ratingCount: Number(candidate.ratingCount || 0) || 0,
        source: candidate.source || "",
      });
      continue;
    }

    const incomingIsLocal = String(candidate.source || "").includes("local_db");
    const existingIsLocal = String(existing.source || "").includes("local_db");
    if (!existing.name && candidate.name) existing.name = candidate.name;
    if ((incomingIsLocal && candidate.publisher) || (!existing.publisher && candidate.publisher)) {
      existing.publisher = candidate.publisher;
    } else if (!existingIsLocal && candidate.publisher && String(candidate.publisher).length > String(existing.publisher || "").length) {
      existing.publisher = candidate.publisher;
    }
    existing.categories = [...new Set([...(existing.categories || []), ...(candidate.categories || [])])];
    existing.ratingCount = Math.max(Number(existing.ratingCount || 0), Number(candidate.ratingCount || 0));
    existing.source = [...new Set([...(existing.source || "").split("+").filter(Boolean), candidate.source].filter(Boolean))]
      .sort((a, b) => (a === "local_db" ? -1 : b === "local_db" ? 1 : a.localeCompare(b)))
      .join("+");
  }
  return [...byKey.values()];
}

function buildMetricTargets(identity) {
  if (identity && identity.unifiedAppId) {
    return [{ os: "unified", appIds: [String(identity.unifiedAppId)] }];
  }
  const targets = [];
  if (identity && Array.isArray(identity.iosAppIds) && identity.iosAppIds.length) {
    targets.push({ os: "ios", appIds: identity.iosAppIds.map(String) });
  }
  if (identity && Array.isArray(identity.androidAppIds) && identity.androidAppIds.length) {
    targets.push({ os: "android", appIds: identity.androidAppIds.map(String) });
  }
  return targets;
}

function listFromResponse(data, preferredKey) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (preferredKey && Array.isArray(data[preferredKey])) return data[preferredKey];
  if (Array.isArray(data.unified)) return data.unified;
  if (Array.isArray(data.ios)) return data.ios;
  if (Array.isArray(data.android)) return data.android;
  if (Array.isArray(data.lines)) return data.lines;
  if (Array.isArray(data.apps)) return data.apps;
  if (data.sales_report_estimates_key) {
    return listFromResponse(data.sales_report_estimates_key, preferredKey);
  }
  return [];
}

function firstValue(item, keys, fallback = null) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") return item[key];
  }
  return fallback;
}

function numberValue(item, keys) {
  const value = firstValue(item, keys, 0);
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseSalesReportEstimates(data) {
  return listFromResponse(data).map((item) => {
    const iphoneUnits = numberValue(item, ["iphone_units", "iu"]);
    const ipadUnits = numberValue(item, ["ipad_units", "au"]);
    const iphoneRevenue = numberValue(item, ["iphone_revenue", "ir"]);
    const ipadRevenue = numberValue(item, ["ipad_revenue", "ar"]);
    const fallbackDownloads = iphoneUnits + ipadUnits;
    const fallbackRevenue = iphoneRevenue + ipadRevenue;
    return {
      appId: String(firstValue(item, ["app_id", "aid", "unified_app_id"], "")),
      country: String(firstValue(item, ["country", "c", "cc"], "")),
      date: String(firstValue(item, ["date", "d"], "")),
      downloads: numberValue(item, ["unified_units", "units", "downloads", "android_units", "u"]) || fallbackDownloads,
      revenue: numberValue(item, ["unified_revenue", "revenue", "android_revenue", "r"]) || fallbackRevenue,
    };
  });
}

function summarizeSales(rows) {
  const downloads = Math.round((rows || []).reduce((sum, row) => sum + (Number(row.downloads) || 0), 0));
  const revenue = Number((rows || []).reduce((sum, row) => sum + (Number(row.revenue) || 0), 0).toFixed(2));
  return {
    downloads,
    revenue,
    rpd: downloads > 0 ? Number((revenue / downloads).toFixed(4)) : null,
  };
}

function parseActiveUsers(data) {
  return listFromResponse(data).map((item) => ({
    appId: String(firstValue(item, ["app_id", "aid", "unified_app_id"], "")),
    country: String(firstValue(item, ["country", "c", "cc"], "")),
    date: String(firstValue(item, ["date", "d"], "")),
    activeUsers: numberValue(item, ["users", "active_users", "dau", "au", "u"]),
  }));
}

function averageActiveUsers(rows) {
  const values = (rows || []).map((row) => Number(row.activeUsers) || 0).filter((value) => value > 0);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function parseRankingHistory(data) {
  const rows = listFromResponse(data);
  return rows.map((item) => ({
    appId: String(firstValue(item, ["app_id", "aid"], "")),
    country: String(firstValue(item, ["country", "c", "cc"], "")),
    date: String(firstValue(item, ["date", "d"], "")),
    rank: numberValue(item, ["rank", "r"]),
    category: String(firstValue(item, ["category", "cat"], "")),
    chartType: String(firstValue(item, ["chart_type", "chart_type_id", "ct"], "")),
  }));
}

function latestRankFromCategoryHistory(data, query) {
  const appBlock = data && data[String(query.appId)];
  const countryBlock = appBlock && appBlock[String(query.country)];
  const categoryBlock = countryBlock && countryBlock[String(query.category)];
  const chartBlock = categoryBlock && categoryBlock[String(query.chartType)];
  if (!chartBlock) return null;
  if (chartBlock.todays_rank != null) return chartBlock.todays_rank;
  const graph = Array.isArray(chartBlock.graphData) ? chartBlock.graphData : [];
  let latest = null;
  for (const row of graph) {
    if (!Array.isArray(row) || row.length < 2 || row[1] == null) continue;
    if (query.endDate) {
      const day = new Date(Number(row[0]) * 1000).toISOString().slice(0, 10);
      if (day > query.endDate) continue;
    }
    latest = row[1];
  }
  return latest;
}

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(date, delta) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function defaultDateWindow(now = new Date()) {
  const anchor = new Date(now);
  const end = addDaysUTC(anchor, -1);
  const start = addDaysUTC(end, -29);
  return {
    startDate: formatDateUTC(start),
    endDate: formatDateUTC(end),
  };
}

function buildProfile(input) {
  const salesSummary = summarizeSales(input.salesRows || []);
  const averageDau = averageActiveUsers(input.activeUserRows || []);
  const arpdau =
    averageDau && averageDau > 0 && salesSummary.revenue != null
      ? Number((salesSummary.revenue / averageDau).toFixed(4))
      : null;
  return {
    generatedAt: input.now || new Date().toISOString(),
    identity: input.identity,
    period: input.period,
    summary: {
      downloads: salesSummary.downloads,
      revenue: salesSummary.revenue,
      rpd: salesSummary.rpd,
      averageDau,
      arpdau,
      timeSpentSeconds: input.timeSpentSeconds ?? null,
      websiteVisits: input.websiteVisits ?? null,
    },
    series: {
      sales: input.salesRows || [],
      activeUsers: input.activeUserRows || [],
      timeSpent: input.timeSpentRows || [],
    },
    rankings: input.rankings || [],
    apiCalls: input.apiCalls || [],
    warnings: input.warnings || [],
  };
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "N/A";
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/A";
  return number.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function renderMarkdownProfile(profile) {
  const identity = profile.identity || {};
  const summary = profile.summary || {};
  const period = profile.period || {};
  const rankings = profile.rankings || [];
  const apiCalls = profile.apiCalls || [];
  const warnings = profile.warnings || [];
  const title = identity.canonicalName || identity.query || "Game Profile";
  const rankingLines = rankings.length
    ? rankings
        .map((rank) => `- ${rank.os || ""} ${rank.device || ""} ${rank.categoryName || rank.category || ""} ${rank.chartType || ""}: #${rank.latestRank || "N/A"}`)
        .join("\n")
    : "- N/A";
  const warningLines = warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "- 无";

  return [
    `# ${title}`,
    "",
    `生成时间: ${profile.generatedAt || ""}`,
    `查询名: ${identity.query || ""}`,
    `发行商: ${identity.publisher || "N/A"}`,
    `Unified App ID: ${identity.unifiedAppId || "N/A"}`,
    `iOS App IDs: ${(identity.iosAppIds || []).join(", ") || "N/A"}`,
    `Android App IDs: ${(identity.androidAppIds || []).join(", ") || "N/A"}`,
    `识别置信度: ${identity.confidence || "N/A"}`,
    "",
    `## 周期`,
    "",
    `${period.startDate || ""} 至 ${period.endDate || ""} / ${period.country || ""}`,
    "",
    `## 总览`,
    "",
    `- 下载量: ${formatNumber(summary.downloads)}`,
    `- 收入: $${formatNumber(summary.revenue, 2)}`,
    `- RPD: ${summary.rpd == null ? "N/A" : `$${formatNumber(summary.rpd, 4)}`}`,
    `- 平均 DAU: ${formatNumber(summary.averageDau)}`,
    `- ARPDAU: ${summary.arpdau == null ? "N/A" : `$${formatNumber(summary.arpdau, 4)}`}`,
    `- 花费时间: ${summary.timeSpentSeconds == null ? "N/A" : `${formatNumber(summary.timeSpentSeconds)} 秒`}`,
    "",
    `## 类别排名`,
    "",
    rankingLines,
    "",
    `## API`,
    "",
    `API 调用数: ${apiCalls.length}`,
    ...apiCalls.map((call) => `- ${call.name || call.url || "unknown"}`),
    "",
    `## 注意事项`,
    "",
    warningLines,
    "",
  ].join("\n");
}

function selectFeishuWebhookEnv(env) {
  const keys = [
    "FEISHU_GAME_GOD_WEBHOOK_URL",
    "FEISHU_WEBHOOK_URL_GAME_GOD",
    "FEISHU_WEEKLY_WEBHOOK_URL",
    "FEISHU_WEBHOOK_URL",
  ];
  for (const key of keys) {
    const value = env && env[key] ? String(env[key]).trim() : "";
    if (value) return { key, value };
  }
  return { key: "", value: "" };
}

function buildFeishuProfileMarkdown(profile) {
  const identity = profile.identity || {};
  const summary = profile.summary || {};
  const period = profile.period || {};
  const rankings = (profile.rankings || []).slice(0, 8);
  const warnings = profile.warnings || [];
  const rankingLines = rankings.length
    ? rankings
        .map((rank) => {
          const label = [rank.os, rank.device, rank.categoryName || rank.category, rank.chartType].filter(Boolean).join(" ");
          return `- ${label}: #${rank.latestRank || "N/A"}`;
        })
        .join("\n")
    : "- N/A";
  const warningLines = warnings.length ? warnings.slice(0, 5).map((warning) => `- ${warning}`).join("\n") : "- 无";
  return [
    `**周期**: ${period.startDate || ""} 至 ${period.endDate || ""} / ${period.country || ""}`,
    `iOS: ${(identity.iosAppIds || []).join(", ") || "N/A"}`,
    `Android: ${(identity.androidAppIds || []).join(", ") || "N/A"}`,
    "",
    `**核心指标**`,
    `- 下载量: ${formatNumber(summary.downloads)}`,
    `- 收入: $${formatNumber(summary.revenue, 0)}`,
    `- RPD: ${summary.rpd == null ? "N/A" : `$${formatNumber(summary.rpd, 4)}`}`,
    `- 平均 DAU: ${formatNumber(summary.averageDau)}`,
    `- ARPDAU: ${summary.arpdau == null ? "N/A" : `$${formatNumber(summary.arpdau, 4)}`}`,
    "",
    `**类别排名**`,
    rankingLines,
    "",
    `**注意事项**`,
    warningLines,
  ].join("\n");
}

function buildFeishuProfileCard(profile) {
  const title = `游戏之神｜${(profile.identity && profile.identity.canonicalName) || "单游戏画像"}`;
  return {
    msg_type: "interactive",
    card: {
      config: {
        wide_screen_mode: true,
      },
      header: {
        template: "turquoise",
        title: {
          tag: "plain_text",
          content: title,
        },
      },
      elements: [
        {
          tag: "markdown",
          content: buildFeishuProfileMarkdown(profile),
        },
      ],
    },
  };
}

module.exports = {
  slugifyName,
  normalizeName,
  nameSimilarity,
  scoreCandidate,
  selectBestCandidate,
  buildIdentityFromCandidates,
  parseAppleSearchResults,
  parseGooglePlaySearchResults,
  parseLocalDbRows,
  filterLocalRowsByQuery,
  localSearchTokens,
  mergeCandidateSources,
  buildMetricTargets,
  parseSalesReportEstimates,
  summarizeSales,
  parseActiveUsers,
  averageActiveUsers,
  parseRankingHistory,
  latestRankFromCategoryHistory,
  defaultDateWindow,
  buildProfile,
  renderMarkdownProfile,
  selectFeishuWebhookEnv,
  buildFeishuProfileMarkdown,
  buildFeishuProfileCard,
};
