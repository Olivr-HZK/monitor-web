"use strict";

/** 与飞书正文字号接近的侧边行内图标（px） */
const FEISHU_INLINE_ICON_PX = 18;

/**
 * 尽量把商店 CDN 上的图标 URL 指向较小尺寸，再交给 img 固定宽高。
 * @param {string} url
 */
function normalizeIconUrlForFeishuInline(url) {
  const u = String(url || "").trim();
  if (!u) return u;
  // Apple：路径里常有 /200x200bb.webp、/150x150bb.jpg 等，压到 60x60 通常仍可用
  if (u.includes("mzstatic.com")) {
    return u.replace(/\/(\d+)x(\d+)(bb\.(?:jpg|webp|png))/i, "/60x60$3");
  }
  // Google Play 图标：末尾常带 =wNN-hNN 或 =sNN，改为小图
  if (u.includes("googleusercontent.com")) {
    let out = u.replace(/=[w](\d+)-h(\d+)(?:-c)?$/i, "=w48-h48-c");
    out = out.replace(/=s\d{2,4}(-c)?$/i, "=s48-c");
    return out;
  }
  return u;
}

/**
 * 将飞书 lark_md 中的 Markdown 图片语法改为固定小尺寸，避免默认铺满一行。
 * @param {string} md
 */
function shrinkFeishuMarkdownImages(md) {
  if (!md || typeof md !== "string") return md;
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, rawUrl) => {
    const u = normalizeIconUrlForFeishuInline(String(rawUrl).trim());
    const esc = u.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const w = FEISHU_INLINE_ICON_PX;
    return `<img src="${esc}" width="${w}" height="${w}" style="vertical-align:middle;margin-right:4px;object-fit:contain;border-radius:20%;"/>`;
  });
}

/**
 * 递归处理交互卡片：markdown 片段 + table 单元格中的 lark_md 字符串。
 * @param {unknown} payload
 */
function walkFeishuInteractivePayload(payload) {
  if (payload == null) return;
  if (Array.isArray(payload)) {
    for (const p of payload) walkFeishuInteractivePayload(p);
    return;
  }
  if (typeof payload !== "object") return;
  const o = payload;
  if (o.tag === "markdown" && typeof o.content === "string") {
    o.content = shrinkFeishuMarkdownImages(o.content);
  }
  if (o.tag === "table" && Array.isArray(o.rows)) {
    for (const row of o.rows) {
      if (!row || typeof row !== "object") continue;
      for (const key of Object.keys(row)) {
        const cell = row[key];
        if (typeof cell === "string") row[key] = shrinkFeishuMarkdownImages(cell);
      }
    }
  }
  for (const k of Object.keys(o)) walkFeishuInteractivePayload(o[k]);
}

module.exports = {
  FEISHU_INLINE_ICON_PX,
  shrinkFeishuMarkdownImages,
  normalizeIconUrlForFeishuInline,
  walkFeishuInteractivePayload,
};
