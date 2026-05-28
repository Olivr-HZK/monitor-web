/**
 * 从 category_history 单条 entry 解析指定自然日 rank。
 * 问题：历史日期 todays_rank 常为 null；graphData 时间戳未必是 UTC 0 点，不能只做 ts 精确相等。
 */
function getRankFromCategoryEntry(entry, dateStr) {
  if (!entry) return null;

  const gd = entry.graphData;
  if (gd && gd.length) {
    // 1) 按 UTC 日历日匹配（取该日最后一个非空点，通常与日榜一致）
    let lastForDay = null;
    for (const row of gd) {
      const ts = row[0];
      const r = row[1];
      if (r == null) continue;
      const day = new Date(ts * 1000).toISOString().slice(0, 10);
      if (day === dateStr) lastForDay = r;
    }
    if (lastForDay != null) return lastForDay;

    // 2) 兼容：恰好 UTC 午夜
    const targetTs = Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
    for (const row of gd) {
      if (row[0] === targetTs && row[1] != null) return row[1];
    }
  }

  // 3) 兜底：部分请求会带 todays_rank（仅在与查询日一致时可信）
  if (entry.todays_rank != null) return entry.todays_rank;

  return null;
}

function getRankFromData(data, q, dateStr) {
  const chartType = q.chart_type_ids[0];
  for (const appId of q.app_ids) {
    if (!data[appId]) continue;
    const byCountry = data[appId];
    for (const country of Object.keys(byCountry)) {
      const byCategory = byCountry[country];
      if (!byCategory[q.category]) continue;
      const byChart = byCategory[q.category];
      if (!byChart[chartType]) continue;
      const rank = getRankFromCategoryEntry(byChart[chartType], dateStr);
      if (rank != null) return rank;
      break;
    }
  }
  return null;
}

module.exports = { getRankFromCategoryEntry, getRankFromData };
