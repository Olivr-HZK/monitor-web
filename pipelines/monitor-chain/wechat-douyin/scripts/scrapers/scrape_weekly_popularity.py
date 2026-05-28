"""
爬取“上周-人气周榜”CSV（用于后续工作流）。

支持两种平台：
- wechat：微信小游戏（只筛选【休闲】，排名取“休闲:X名”的 X，周平均排名写入“发布时间”）
- douyin：抖音小游戏（先切到抖音 tab 再点周榜；排名取第 x 条；“排名变化”写标签内容）

每次运行输出四个榜单（当 --platform all 时）或两个榜单（单平台时）：
- 完整休闲榜：wx_full.csv（微信休闲完整）、dy_full.csv（抖音周榜完整）
- 异动榜：wx_anomalies.csv、dy_anomalies.csv（排名飙升>10 或 新进榜）
- 榜单类型由 --chart 控制：most_played=人气榜区块，bestseller=畅销榜区块，both=人气+畅销+第三榜（微信=畅玩、抖音=新游，均为第 3 个榜单头内的「周榜」）
- 人气榜 CSV：`data/人气榜/{周范围}/`（wx_full、dy_full 等）
- 畅销榜 CSV：`data/畅销榜/{周范围}/`（同名文件，目录区分）

统一 CSV 格式（11 列）：
排名,游戏名称,游戏类型,平台,来源,榜单,监控日期,发布时间,开发公司,排名变化,地区

用法：
  python scrape_weekly_popularity.py --platform all   # 一次拉取四份榜单（推荐）
  python scrape_weekly_popularity.py --platform wechat
  python scrape_weekly_popularity.py --platform douyin --monitor-date 2026-01-19
  python scrape_weekly_popularity.py --chart bestseller --platform douyin --limit 30
  python scrape_weekly_popularity.py --chart both --platform douyin   # 人气+畅销都爬并打印预览
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, List, Optional, Tuple, Dict

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright


TARGET_URL = "https://web.gravity-engine.com/#/manage/rank"
DATA_ROOT = Path(os.environ.get("WECHAT_DOUYIN_DATA_DIR", "data")).expanduser()
DEFAULT_USER_DATA_DIR = DATA_ROOT / "pw_user_data"


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


RANK_READY_ATTEMPTS = _env_int("GE_RANK_READY_ATTEMPTS", 6)
RANK_READY_SETTLE_MS = _env_int("GE_RANK_READY_SETTLE_MS", 2000)
RANK_READY_TIMEOUT_MS = _env_int("GE_RANK_READY_TIMEOUT_MS", 25000)


@dataclass
class WeeklyItem:
    rank: int
    name: str
    game_type: str
    tags: List[str]
    avg_rank: Optional[float]
    company: str
    rank_change: str


def _parse_ymd(s: str) -> Optional[date]:
    s = (s or "").strip()
    if not s:
        return None
    parts = re.split(r"[-/]", s)
    if len(parts) >= 3 and all(p.strip().isdigit() for p in parts[:3]):
        try:
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
        except Exception:
            return None
    return None


def _prev_week_range(ref: date) -> Tuple[date, date]:
    """上一周（周一~周日）"""
    this_monday = ref - timedelta(days=ref.weekday())
    prev_monday = this_monday - timedelta(days=7)
    prev_sunday = this_monday - timedelta(days=1)
    return prev_monday, prev_sunday


def _week_range_str(start: date, end: date) -> str:
    """返回周区间字符串，例如 2026-01-19~2026-01-25（月份/日期一律补零），用于文件夹命名。"""
    return (
        f"{start.year}-{start.month:02d}-{start.day:02d}"
        f"~{end.year}-{end.month:02d}-{end.day:02d}"
    )


def _safe_int(s: str, fallback: int) -> int:
    s = (s or "").strip()
    m = re.search(r"\d+", s)
    if not m:
        return fallback
    try:
        return int(m.group(0))
    except Exception:
        return fallback


def _parse_avg_rank(s: str) -> Optional[float]:
    s = (s or "").strip()
    if not s:
        return None
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def _extract_desc_and_avg(desc_texts: List[str]) -> Tuple[str, str]:
    """
    从多个 desc 文本里拆出：
    - main_desc：包含“类型:名次 + 公司”
    - avg_desc：包含“周平均排名:xx”
    """
    main_parts: List[str] = []
    avg_parts: List[str] = []
    for t in desc_texts:
        t = (t or "").strip()
        if not t:
            continue
        if "周平均排名" in t:
            avg_parts.append(t)
        else:
            main_parts.append(t)
    return "".join(main_parts).strip(), " ".join(avg_parts).strip()


def _parse_main_desc(main_desc: str) -> Tuple[str, Optional[int], str]:
    """
    main_desc 示例：其他:2名杭州起源优游科技有限公司
    返回：(game_type, tag_rank_no, company)
    """
    s = (main_desc or "").strip()
    if not s:
        return "", None, "--"

    m = re.search(r"(?P<cate>[^:：\s]+)\s*[:：]\s*(?P<no>\d+)\s*名", s)
    if not m:
        # 没有“类型:名次”结构，尽量把整段当公司
        company = s.strip() or "--"
        return "", None, company

    cate = m.group("cate").strip()
    no = m.group("no").strip()
    try:
        tag_rank_no = int(no)
    except Exception:
        tag_rank_no = None

    # 去掉“类型:名次”，剩余当公司
    company = re.sub(r"(?P<cate>[^:：\s]+)\s*[:：]\s*(?P<no>\d+)\s*名", "", s, count=1).strip()
    if not company:
        company = "--"
    return cate, tag_rank_no, company


# 引力引擎页面上升/下降图标的 SVG path d 特征（用于判断排名变化方向）
_SVG_UP_PATH_SIGNATURE = "704h639"  # 上升三角形 path d 含此片段，如 M512 320 192 704h639.936z
_SVG_DOWN_PATH_SIGNATURE = "320-384"  # 下降三角形 path d 含此片段，如 m192 384 320 384 320-384z


def _parse_rank_change(tag_texts: List[str]) -> str:
    """
    从标签文案里提取排名变化（文案中已带 ↑/↓/- 时用）。
    若仅靠文案无法区分方向，由调用方结合图标再判断。
    """
    for t in tag_texts:
        t = (t or "").strip()
        if not t:
            continue
        if t in {"新进榜", "新入榜"}:
            return t

    for t in tag_texts:
        t = (t or "").strip()
        if not t:
            continue
        if "↓" in t or (t.startswith("-") and t[1:].strip().isdigit()) or "下降" in t:
            num = re.search(r"\d+", t)
            if num:
                return f"↓{num.group(0)}"
        if "↑" in t or (t.startswith("+") and t[1:].strip().isdigit()) or re.fullmatch(r"\d+", t):
            num = re.search(r"\d+", t)
            if num:
                return f"↑{num.group(0)}"
    return "--"


def _get_rank_change_from_node(node) -> str:
    """
    从当前 rank-item 节点中根据「图标 + 文案」解析排名变化。
    优先识别 el-icon 内 SVG path：上升三角形 -> ↑N，下降三角形 -> ↓N；
    否则回退到仅用 el-tag__content 文案的 _parse_rank_change。
    """
    try:
        # 该条目的所有「标签」容器（通常含图标 + 文案）
        tag_containers = node.locator("xpath=.//span[contains(@class,'el-tag__content')]/..")
        n = tag_containers.count()
        for idx in range(n):
            container = tag_containers.nth(idx)
            text = ""
            try:
                text = container.locator("xpath=.//span[contains(@class,'el-tag__content')]").first.inner_text().strip()
            except Exception:
                continue
            if not text:
                continue
            if text in {"新进榜", "新入榜"}:
                return text
            # 同一容器内找 SVG path 的 d 属性，判断上升/下降
            try:
                path_el = container.locator("svg path[fill='currentColor']").first
                if path_el.count() == 0:
                    path_el = container.locator("svg path").first
                d = path_el.get_attribute("d") or ""
                num = re.search(r"\d+", text)
                if num:
                    if _SVG_DOWN_PATH_SIGNATURE in d:
                        return f"↓{num.group(0)}"
                    if _SVG_UP_PATH_SIGNATURE in d:
                        return f"↑{num.group(0)}"
            except Exception:
                pass
            # 无图标或未匹配到时，纯数字按上升处理
            if re.fullmatch(r"\d+", text.strip()):
                return f"↑{text.strip()}"
        # 没有通过容器解析到，用整条目的所有 tag 文案再试一次
        tag_texts = [t.strip() for t in node.locator("xpath=.//span[contains(@class,'el-tag__content')]").all_inner_texts()]
        return _parse_rank_change(tag_texts)
    except Exception:
        tag_texts = []
        try:
            tag_texts = [t.strip() for t in node.locator("xpath=.//span[contains(@class,'el-tag__content')]").all_inner_texts()]
        except Exception:
            pass
        return _parse_rank_change(tag_texts)


def _heat(rank: int) -> str:
    return str(max(0, 100 - (rank - 1) * 2))


def _parse_rank_change_value(rank_change_str: str) -> Optional[int]:
    """
    解析排名变化字符串为数值（用于异动筛选：>10 为飙升）
    - "↑25" -> 25（上升）
    - "↓10" -> -10（下降）
    - 新进榜 -> None
    """
    if not rank_change_str or rank_change_str == "--":
        return None

    if "新进榜" in rank_change_str or "新入榜" in rank_change_str:
        return None  # 新进榜

    # 下降：↓10、-10
    if "↓" in rank_change_str or (rank_change_str.strip().startswith("-") and rank_change_str.strip()[1:].strip().isdigit()):
        match = re.search(r"\d+", rank_change_str)
        if match:
            try:
                return -int(match.group(0))
            except Exception:
                pass
        return None
    # 上升：↑25、+25、25
    match = re.search(r"\d+", rank_change_str)
    if match:
        try:
            return int(match.group(0))
        except Exception:
            return None
    return None


def read_previous_csv(csv_path: Path) -> Dict[str, int]:
    """
    读取上周 CSV 文件，构建游戏名称到排名的映射

    Args:
        csv_path: CSV 文件路径

    Returns:
        字典：{游戏名称: 排名}
    """
    if not csv_path.exists():
        return {}

    previous_map = {}
    try:
        with csv_path.open("r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                game_name = row.get("游戏名称", "").strip()
                rank_str = row.get("排名", "").strip()
                if game_name and rank_str:
                    try:
                        rank = int(rank_str)
                        previous_map[game_name] = rank
                    except:
                        pass
    except Exception as e:
        print(f"  ⚠ 读取上周 CSV 失败：{e}")

    return previous_map


def filter_anomalies_only(
    items: List[WeeklyItem],
    rank_surge_threshold: int = 10
) -> List[WeeklyItem]:
    """
    只保留异动游戏：新进榜，或 上升>阈值，或 下降>阈值（绝对值）。
    直接使用「排名变化」字段判断。
    """
    anomalies = []
    for item in items:
        rank_change = item.rank_change or "--"
        if "新进榜" in rank_change or "新入榜" in rank_change:
            anomalies.append(item)
            continue
        change_value = _parse_rank_change_value(rank_change)
        if change_value is None:
            continue
        # 上升 > 阈值 或 下降 > 阈值（绝对值）
        if change_value > rank_surge_threshold or change_value < -rank_surge_threshold:
            anomalies.append(item)
    return anomalies


def _chart_section_class(chart: str) -> str:
    """页面区块 class：人气榜 most_played，畅销榜 bestseller（third 不走此函数）。"""
    if chart == "bestseller":
        return "bestseller"
    return "most_played"


# 从左到右：第 1 个可见榜单头=人气榜，第 2 个=畅销榜，第 3 个=畅玩/新游（与页面「周榜」列对齐，避免依赖易变的 class）
_BESTSELLER_CHART_COLUMN_INDEX = 1
# 第三榜：当前 tab 下从左到右第 3 个「可见」榜单头内的「周榜」（微信畅玩 / 抖音新游）
_THIRD_CHART_COLUMN_INDEX = 2


def _nth_visible_rank_header(page, visible_index_zero_based: int):
    """
    仅统计 is_visible() 的 rank-list-item-header，避免另一平台 tab 里隐藏的 header
    占位导致 (//header)[3] 点到错误列。
    """
    headers = page.locator("xpath=//div[contains(@class,'rank-list-item-header')]")
    seen = 0
    try:
        n = headers.count()
    except Exception:
        n = 0
    for i in range(min(n, 40)):
        h = headers.nth(i)
        try:
            if h.is_visible(timeout=2000):
                if seen == visible_index_zero_based:
                    return h
                seen += 1
        except Exception:
            continue
    return None


def _rank_items_under_header(page, header) -> Any:
    """
    给定榜单头，取同列 rank-item。
    沿 header 向上找祖先，优先选「约 20 条」rank-item 的容器，避免回落到全页第一条（会变成人气列）。
    """
    candidates: List[Tuple[int, Any]] = []
    try:
        anc = header
        for _depth in range(1, 12):
            anc = anc.locator("xpath=..")
            items = anc.locator("xpath=.//div[contains(@class,'rank-item')]")
            try:
                n = items.count()
            except Exception:
                continue
            if 15 <= n <= 25:
                return items
            if 5 <= n <= 60:
                candidates.append((n, items))
    except Exception:
        pass
    if candidates:
        good = [c for c in candidates if c[0] <= 30]
        if good:
            good.sort(key=lambda x: abs(x[0] - 20))
            return good[0][1]
        candidates.sort(key=lambda x: abs(x[0] - 20))
        return candidates[0][1]
    try:
        sib = header.locator("xpath=following-sibling::*").first
        items2 = sib.locator("xpath=.//div[contains(@class,'rank-item')]")
        if items2.count() > 0:
            return items2
    except Exception:
        pass
    return page.locator("xpath=//div[contains(@class,'rank-item')]")


def _week_button_under_header(header) -> Any:
    """榜单头内「周榜」按钮：优先 `button-item` + `hover-color`（与线上一致）。"""
    strict = header.locator(
        "xpath=.//div[contains(@class,'button-item') and contains(@class,'hover-color') "
        "and contains(normalize-space(.), '周榜')]"
    )
    try:
        if strict.count() > 0:
            return strict.first
    except Exception:
        pass
    return header.locator(
        "xpath=.//div[contains(@class,'button-item') and contains(normalize-space(.), '周榜')]"
    ).first


def _week_button_locator(page, section_class: str):
    """在指定榜单区块（header 含 most_played / bestseller）内点击「周榜」。"""
    # 使用 contains(@class) 与页面实际 class 列表一致（避免 CSS 多类名在部分环境下匹配不到）
    return page.locator(
        f"xpath=//div[contains(@class,'rank-list-item-header') and contains(@class,'{section_class}')]"
        f"//div[contains(@class,'button-item') and contains(normalize-space(.), '周榜')]"
    ).first


def _week_button_locator_by_column_index(page, col_index: int):
    """
    按「第几个榜单头」取周榜按钮（0=左/第一块，1=右/第二块）。
    部分平台（如抖音）第二块人气榜可能不带 most_played class，需与 _chart_section_class 搭配回退。
    """
    # XPath 下标从 1 开始
    n = col_index + 1
    return page.locator(
        f"xpath=(//div[contains(@class,'rank-list-item-header')])[{n}]"
        f"//div[contains(@class,'button-item') and contains(normalize-space(.), '周榜')]"
    ).first


def _rank_items_locator_by_column_index(page, col_index: int):
    """与 _week_button_locator_by_column_index 同一列下的 rank-item。"""
    n = col_index + 1
    header = page.locator(
        f"xpath=(//div[contains(@class,'rank-list-item-header')])[{n}]"
    ).first
    col = header.locator("xpath=..")
    items = col.locator("xpath=.//div[contains(@class,'rank-item')]")
    try:
        if items.count() > 0:
            return items
    except Exception:
        pass
    try:
        sib = header.locator("xpath=following-sibling::*").first
        items2 = sib.locator("xpath=.//div[contains(@class,'rank-item')]")
        if items2.count() > 0:
            return items2
    except Exception:
        pass
    return page.locator("xpath=//div[contains(@class,'rank-item')]")


def _rank_items_locator(page, section_class: str):
    """
    抓取指定榜单列下的 rank-item（header 与列表通常在同一个父容器内）。
    若结构不符则回退为全页 rank-item（兼容旧 DOM）。
    """
    headers = page.locator(
        f"xpath=//div[contains(@class,'rank-list-item-header') and contains(@class,'{section_class}')]"
    )
    try:
        if headers.count() == 0:
            return page.locator("xpath=//div[contains(@class,'rank-item')]")
    except Exception:
        pass
    header = headers.first
    col = header.locator("xpath=..")
    items = col.locator("xpath=.//div[contains(@class,'rank-item')]")
    try:
        if items.count() > 0:
            return items
    except Exception:
        pass
    # header 与列表为兄弟节点时
    try:
        sib = header.locator("xpath=following-sibling::*").first
        items2 = sib.locator("xpath=.//div[contains(@class,'rank-item')]")
        if items2.count() > 0:
            return items2
    except Exception:
        pass
    return page.locator("xpath=//div[contains(@class,'rank-item')]")


def _dismiss_overlays(page) -> None:
    """关闭可能遮挡 tab/周榜 的弹窗。"""
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    except Exception:
        pass
    for close_sel in [
        ".el-dialog__headerbtn",
        ".el-dialog__close",
        "[class*='dialog'] [class*='close']",
        "button:has-text('关闭')",
        "button:has-text('确定')",
    ]:
        try:
            btn = page.locator(close_sel).first
            if btn.count() > 0 and btn.is_visible():
                btn.click(timeout=2000)
                page.wait_for_timeout(500)
                break
        except Exception:
            continue


def _save_rank_dom_diagnostics(page, platform: str, chart: str, chart_label: str) -> Optional[Path]:
    """
    保存页面结构诊断，帮助区分：
    - 周榜弹层/周榜列表没有打开；
    - 周榜列表 DOM 类名变化；
    - 只剩页面背景榜单（rank-child-item），不能当周榜入库。

    注意：诊断只读页面，不作为数据 fallback。正式周榜仍只信任 rank-item。
    """
    try:
        debug_dir = DATA_ROOT / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        debug_path = debug_dir / f"rank_dom_{platform}_{chart}_{stamp}.json"
        payload = page.evaluate(
            """({ platform, chart, chartLabel }) => {
              const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return el.offsetParent !== null && style.visibility !== 'hidden' && style.display !== 'none';
              };
              const textOf = (el, max = 280) => String(el?.innerText || el?.textContent || '').trim().slice(0, max);
              const classOf = (el) => {
                const raw = el?.className || '';
                return typeof raw === 'string' ? raw : String(raw);
              };
              const headers = [...document.querySelectorAll('div[class*="rank-list-item-header"]')]
                .filter(visible)
                .slice(0, 8)
                .map((h, idx) => {
                  const col = h.parentElement;
                  return {
                    visibleIndex: idx,
                    className: classOf(h),
                    text: textOf(h, 120),
                    buttons: [...h.querySelectorAll('div[class*="button-item"]')].map((b) => ({
                      text: textOf(b, 30),
                      className: classOf(b),
                    })),
                    columnClassName: classOf(col),
                    columnRankItemCount: col ? col.querySelectorAll('div[class*="rank-item"]').length : 0,
                    columnRankChildItemCount: col ? col.querySelectorAll('div[class*="rank-child-item"]').length : 0,
                    columnTextSample: textOf(col, 420),
                  };
                });
              const dialogs = [...document.querySelectorAll('div[class*="rank-dialog"], div[class*="rank-data-wrapper"]')]
                .slice(0, 8)
                .map((el, idx) => ({
                  index: idx,
                  visible: visible(el),
                  className: classOf(el),
                  rankItemCount: el.querySelectorAll('div[class*="rank-item"]').length,
                  rankChildItemCount: el.querySelectorAll('div[class*="rank-child-item"]').length,
                  textSample: textOf(el, 420),
                }));
              const bodyText = textOf(document.body, 2000);
              return {
                capturedAt: new Date().toISOString(),
                url: location.href,
                platform,
                chart,
                chartLabel,
                counts: {
                  rankItem: document.querySelectorAll('div[class*="rank-item"]').length,
                  rankChildItem: document.querySelectorAll('div[class*="rank-child-item"]').length,
                  rankDialog: document.querySelectorAll('div[class*="rank-dialog"]').length,
                  rankDataWrapper: document.querySelectorAll('div[class*="rank-data-wrapper"]').length,
                },
                flags: {
                  hasLoginHistoryNotice: bodyText.includes('登录之后即可查看历史排行数据'),
                  hasLoginNowText: bodyText.includes('立即登录'),
                  hasWeekAverageText: bodyText.includes('周平均排名'),
                },
                visibleHeaders: headers,
                dialogs,
              };
            }""",
            {"platform": platform, "chart": chart, "chartLabel": chart_label},
        )
        debug_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return debug_path
    except Exception as e:
        print(f"[!] 保存 DOM 诊断失败：{e}")
        return None


def scrape_one_platform(
    page,
    platform: str,
    limit: int,
    chart: str = "most_played",
) -> List[WeeklyItem]:
    """
    在当前页面上抓取一个平台的周榜（微信=休闲周榜，抖音=抖音小游戏周榜）。
    - platform "wechat" 时会先切到微信小游戏 tab（与抖音对称，避免默认停在抖音榜）。
    - platform "douyin" 时会先点击抖音 tab 再点周榜。
    - chart：most_played=人气榜（微信/抖音均=第 1 个可见榜单头内「周榜」，hover-color 优先；
      抖音 tab 优先点 douyin_tab_rank_select 图），bestseller=畅销榜区块内点「周榜」，
      third=第 3 个可见榜单头内「周榜」（微信畅玩 / 抖音新游）。
    - limit 为 0 表示不限制条数；否则最多抓取 limit 条。
    返回解析后的 WeeklyItem 列表。
    """
    _dismiss_overlays(page)
    if chart == "third":
        chart_label = "畅玩榜" if platform == "wechat" else "新游榜"
    else:
        chart_label = "畅销榜" if chart == "bestseller" else "人气榜"

    # 微信：显式切到微信小游戏 tab（资源名含 wx_tab_rank，如 wx_tab_rank_select-xxx.png）
    if platform == "wechat":
        try:
            wx_tab = page.locator("xpath=//img[contains(@src,'wx_tab_rank')]").first
            wx_tab.wait_for(state="visible", timeout=60000)
            wx_tab.click(timeout=8000)
            page.wait_for_timeout(3000)
            print("[*] 已切换到微信小游戏榜")
        except Exception as e:
            try:
                wx_tab = page.locator("xpath=//img[contains(@src,'wx_tab_rank')]").first
                wx_tab.click(force=True, timeout=3000)
                page.wait_for_timeout(3000)
                print("[*] 已切换到微信小游戏榜（force click）")
            except Exception as e2:
                print(f"[!] 切换到微信小游戏榜失败：{e2}，继续尝试当前视图")

    # 抖音：切换到抖音小游戏 tab（优先点击选中态 douyin_tab_rank_select-*.png，与 rank.gravity-engine.com 资源一致）
    if platform == "douyin":
        try:
            clicked = False
            for label, xp in (
                ("douyin_tab_rank_select", "//img[contains(@src,'douyin_tab_rank_select')]"),
                (
                    "douyin_tab_rank",
                    "//img[contains(@src,'douyin_tab_rank') and not(contains(@src,'douyin_tab_rank_select'))]",
                ),
            ):
                loc = page.locator(f"xpath={xp}").first
                try:
                    loc.wait_for(state="visible", timeout=25000)
                    loc.click(timeout=8000)
                    print(f"[*] 已切换到抖音小游戏榜（{label}）")
                    clicked = True
                    break
                except Exception:
                    continue
            if not clicked:
                loc = page.locator("xpath=//img[contains(@src,'douyin_tab_rank')]").first
                loc.wait_for(state="visible", timeout=60000)
                loc.click(timeout=8000)
                print("[*] 已切换到抖音小游戏榜（fallback: douyin_tab_rank 任意匹配）")
            page.wait_for_timeout(3000)
        except Exception as e:
            try:
                page.locator("xpath=//img[contains(@src,'douyin_tab_rank')]").first.click(
                    force=True, timeout=3000
                )
                page.wait_for_timeout(3000)
                print("[*] 已切换到抖音小游戏榜（force click）")
            except Exception as e2:
                print(f"[!] 切换到抖音小游戏榜失败：{e2}")
                return []

    # 在指定榜单区块内点击「周榜」，并在未出现 rank-item 时重试几次（SPA 加载慢或首次点击未生效）
    # 微信人气榜：必须用「第 1 个可见榜单头」，不能依赖 most_played class（页面上常与畅玩列错位）
    # 畅销榜：第 2 个可见榜单头 + 周榜（与 class=bestseller 解耦，避免点到人气/畅玩列）
    # third：当前 tab 下第 3 个「可见」榜单头内的「周榜」（微信畅玩 / 抖音新游）
    if chart == "third":
        hdr = _nth_visible_rank_header(page, _THIRD_CHART_COLUMN_INDEX)
        if hdr is None:
            print(f"[!] 未找到第 {_THIRD_CHART_COLUMN_INDEX + 1} 个可见榜单头（{chart_label}）")
            return []
        week_btn = _week_button_under_header(hdr)

        def _rank_scope():
            return _rank_items_under_header(page, hdr)

        rank_scope = _rank_scope
    elif chart == "bestseller" and platform in ("wechat", "douyin"):
        hdr = _nth_visible_rank_header(page, _BESTSELLER_CHART_COLUMN_INDEX)
        if hdr is None:
            print(
                f"[!] {'微信' if platform == 'wechat' else '抖音'}："
                f"未找到可见的第 {_BESTSELLER_CHART_COLUMN_INDEX + 1} 个榜单头（畅销榜）"
            )
            return []
        week_btn = _week_button_under_header(hdr)

        def _rank_scope():
            return _rank_items_under_header(page, hdr)

        rank_scope = _rank_scope
        print(
            f"[*] {'微信' if platform == 'wechat' else '抖音'}畅销榜："
            f"第 {_BESTSELLER_CHART_COLUMN_INDEX + 1} 个可见榜单头内「周榜」（hover-color 优先）"
        )
    elif chart == "most_played" and platform in ("wechat", "douyin"):
        # 微信/抖音人气：第 1 个可见榜单头 + 周榜（hover-color 优先）；不依赖 most_played class（抖音曾错列）
        hdr = _nth_visible_rank_header(page, 0)
        if hdr is None:
            print(f"[!] {'微信' if platform == 'wechat' else '抖音'}：未找到可见的第 1 个榜单头（人气榜）")
            return []
        week_btn = _week_button_under_header(hdr)

        def _rank_scope():
            return _rank_items_under_header(page, hdr)

        rank_scope = _rank_scope
        print(
            f"[*] {'微信' if platform == 'wechat' else '抖音'}人气榜："
            f"第 1 个可见榜单头内「周榜」（hover-color 优先）"
        )
    else:
        section_class = _chart_section_class(chart)
        week_btn = _week_button_locator(page, section_class)

        def _rank_scope():
            return _rank_items_locator(page, section_class)

        rank_scope = _rank_scope
    try:
        week_btn.scroll_into_view_if_needed(timeout=10000)
    except Exception:
        pass
    try:
        week_btn.wait_for(state="visible", timeout=60000)
    except Exception as e1:
        if chart == "third":
            print(f"[!] 未找到第三榜（{chart_label}）内的「周榜」按钮：{e1}")
            return []
        if chart == "most_played" and platform in ("wechat", "douyin"):
            print(
                f"[!] {'微信' if platform == 'wechat' else '抖音'}人气榜："
                f"第 1 个可见榜单头内未找到「周榜」按钮：{e1}"
            )
            return []
        else:
            print(f"[!] 未找到「{chart_label}」区块内的「周榜」按钮：{e1}")
            return []

    rank_ready = False
    for attempt in range(RANK_READY_ATTEMPTS):
        try:
            week_btn.click(timeout=5000)
        except Exception as e:
            print(f"[!] 点击「{chart_label}」内「周榜」失败：{e}")
            return []
        page.wait_for_timeout(RANK_READY_SETTLE_MS)
        try:
            scoped = rank_scope()
            scoped.first.wait_for(state="visible", timeout=RANK_READY_TIMEOUT_MS)
            rank_ready = True
            break
        except Exception:
            print(f"[*] 等待 rank-item（第 {attempt + 1}/{RANK_READY_ATTEMPTS} 次）…")
            _dismiss_overlays(page)
            page.wait_for_timeout(2000)

    if not rank_ready:
        print("[!] 未检测到周榜 rank-item（可能未打开周榜弹层、周榜未加载完成，或 DOM 类名已变化）")
        try:
            debug_dir = DATA_ROOT / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            debug_path = debug_dir / f"rank_empty_{platform}_{chart}_{stamp}.png"
            page.screenshot(path=str(debug_path), full_page=True)
            print(f"[*] 已保存失败截图：{debug_path}")
        except Exception as e:
            print(f"[!] 保存失败截图失败：{e}")
        diag_path = _save_rank_dom_diagnostics(page, platform, chart, chart_label)
        if diag_path:
            print(f"[*] 已保存周榜 DOM 诊断：{diag_path}")
        print("[!] 安全策略：不从页面背景榜单 rank-child-item 兜底入库，避免把日榜/错误列误当周榜。")
        return []

    all_items = rank_scope()
    total = all_items.count()
    if total <= 0:
        print("[!] 未抓到任何榜单条目")
        return []

    want = limit if limit > 0 else total
    if platform == "douyin":
        print(
            f"[*] 找到 rank-item: {total}，将读取前 {min(want, total)} 条作为"
            f"【抖音小游戏·{chart_label}·周榜】"
        )
    else:
        # 微信：人气 / 畅销 / 畅玩均只保留「休闲」
        print(
            f"[*] 找到 rank-item: {total}，将筛选【休闲】并最多输出 {want} 条"
            f"（{chart_label}）"
        )

    results: List[WeeklyItem] = []
    for i in range(total):
        node = all_items.nth(i)
        overall_rank_no = i + 1
        if platform != "douyin":
            try:
                rank_text = node.locator("xpath=.//div[contains(@class,'rank-index')]//span[contains(@class,'index')]").first.inner_text().strip()
            except Exception:
                rank_text = ""
            overall_rank_no = _safe_int(rank_text, i + 1)

        try:
            name = node.locator("xpath=.//span[contains(@class,'font-bold')]").first.inner_text().strip()
        except Exception:
            name = ""

        try:
            desc_texts = [t.strip() for t in node.locator("xpath=.//div[contains(@class,'desc')]").all_inner_texts()]
        except Exception:
            desc_texts = []
        main_desc, avg_desc = _extract_desc_and_avg(desc_texts)

        try:
            tag_texts = [t.strip() for t in node.locator("xpath=.//span[contains(@class,'el-tag__content')]").all_inner_texts()]
        except Exception:
            tag_texts = []

        avg_rank = _parse_avg_rank(avg_desc)

        # 排名变化：优先按节点内「图标 + 文案」解析（上升/下降三角形），否则用文案
        rank_change = _get_rank_change_from_node(node)
        if not rank_change or rank_change == "--":
            rank_change = _parse_rank_change(tag_texts) if tag_texts else "--"

        if platform == "douyin":
            rank_no = overall_rank_no
            game_type = "--"
            company = "--"
            tags: List[str] = []
            if avg_desc:
                tags.append(avg_desc)
            elif desc_texts:
                tags.append(desc_texts[0])
        elif chart == "third":
            game_type, tag_rank_no, company = _parse_main_desc(main_desc)
            # 微信畅玩榜：仅休闲（与抖音新游榜区分：抖音 third 不过滤）
            if platform == "wechat" and (game_type or "").strip() != "休闲":
                continue
            rank_no = tag_rank_no if tag_rank_no is not None else overall_rank_no
            tags = []
            if tag_rank_no is not None and game_type:
                tags.append(f"{game_type}:{tag_rank_no}名")
            elif tag_rank_no is not None:
                tags.append(f"{tag_rank_no}名")
            for t in tag_texts:
                if t and t not in tags:
                    tags.append(t)
            if not rank_change or rank_change == "--":
                rank_change = "--"
        else:
            game_type, tag_rank_no, company = _parse_main_desc(main_desc)
            if chart in ("most_played", "bestseller") and (game_type or "").strip() != "休闲":
                continue
            rank_no = tag_rank_no if tag_rank_no is not None else overall_rank_no
            tags = []
            if tag_rank_no is not None:
                tags.append(f"{game_type}:{tag_rank_no}名")
            for t in tag_texts:
                if t and t not in tags:
                    tags.append(t)
            if not rank_change or rank_change == "--":
                rank_change = "--"

        it = WeeklyItem(
            rank=rank_no,
            name=name,
            game_type=game_type or "--",
            tags=tags,
            avg_rank=avg_rank,
            company=company or "--",
            rank_change=rank_change,
        )
        results.append(it)
        if limit > 0 and len(results) >= limit:
            break

    return results


def write_csv(
    items: List[WeeklyItem],
    output_csv: Path,
    *,
    monitor_date: str,
    platform: str,
    source: str,
    board_name: str,
) -> None:
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    # 新的统一格式：删除热度指数和标签，增加地区列
    fieldnames = [
        "排名",
        "游戏名称",
        "游戏类型",
        "平台",
        "来源",
        "榜单",
        "监控日期",
        "发布时间",
        "开发公司",
        "排名变化",
        "地区",
    ]

    with output_csv.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for it in items:
            # wechat：周平均排名写到“发布时间”；douyin：周平均排名写到“标签”，这里发布时间填 --
            # 统一处理：微信和抖音都将周平均排名写到"发布时间"
            publish = f"周平均排名:{it.avg_rank}" if it.avg_rank is not None else "--"
            w.writerow(
                {
                    "排名": str(it.rank),
                    "游戏名称": it.name,
                    "游戏类型": it.game_type or "--",
                    "平台": platform,
                    "来源": source,
                    "榜单": board_name,
                    "监控日期": monitor_date,
                    "发布时间": publish,
                    "开发公司": it.company or "--",
                    "排名变化": it.rank_change or "--",
                    "地区": "中国",  # 微信/抖音固定为中国
                }
            )


def _board_names_for(platform: str, chart: str) -> Tuple[str, str]:
    """返回 (完整榜名称, 异动榜名称)。"""
    if chart == "third":
        if platform == "douyin":
            return ("抖音小游戏新游周榜", "抖音小游戏新游周榜异动")
        return ("微信小游戏畅玩周榜（休闲完整）", "微信小游戏畅玩周榜异动")
    if platform == "douyin":
        if chart == "bestseller":
            return ("抖音小游戏畅销周榜", "抖音小游戏畅销周榜异动")
        return ("抖音小游戏周榜", "抖音小游戏周榜异动")
    if chart == "bestseller":
        return ("微信小游戏畅销周榜（休闲完整）", "微信小游戏畅销周榜异动")
    return ("微信小游戏人气周榜（休闲完整）", "微信小游戏人气周榜异动")


def _csv_base_prefix(platform: str) -> str:
    """wx / dy。人气榜与畅销榜分目录存放，文件名均用此前缀。"""
    return "dy" if platform == "douyin" else "wx"


def _week_output_dir(chart: str, week_range: str) -> Path:
    """人气榜 / 畅销榜 / 畅玩榜（第三榜 wx+dy 共用目录，入库用 chart_key 区分）。"""
    if chart == "bestseller":
        return DATA_ROOT / "畅销榜" / week_range
    if chart == "third":
        return DATA_ROOT / "畅玩榜" / week_range
    return DATA_ROOT / "人气榜" / week_range


def _charts_from_arg(chart_arg: str) -> List[str]:
    if chart_arg == "both":
        return ["most_played", "bestseller", "third"]
    return [chart_arg]


def print_results_preview(
    items: List[WeeklyItem],
    title: str,
    *,
    max_rows: int = 80,
) -> None:
    """控制台打印榜单：排名、游戏名、排名变化（便于对照两个榜）。"""
    print(f"\n┌── {title} ──")
    if not items:
        print("│ （无数据）")
        print("└" + "─" * 60)
        return
    show_n = len(items) if max_rows <= 0 else min(len(items), max_rows)
    for i in range(show_n):
        it = items[i]
        name = (it.name or "")[:42]
        rc = it.rank_change or "--"
        print(f"│ {it.rank:>3}  {name:<42}  {rc}")
    if len(items) > show_n:
        print(f"│ … 共 {len(items)} 条，仅显示前 {show_n} 条（可用 --print-max-rows 0 显示全部）")
    print("└" + "─" * 60)


def main() -> int:
    ap = argparse.ArgumentParser(description="爬取上周人气周榜，输出完整榜+异动榜（wx/dy 各两份）")
    ap.add_argument("--monitor-date", default="", help="监控日期 YYYY-MM-DD（默认今天）")
    ap.add_argument("--limit", type=int, default=0, help="每平台最多抓取条数，0=不限制（默认0）")
    ap.add_argument("--user-data-dir", default=str(DEFAULT_USER_DATA_DIR), help="持久化浏览器目录（用于复用登录态）")
    ap.add_argument("--platform", choices=["wechat", "douyin", "all"], default="all",
                    help="平台：wechat=仅微信，douyin=仅抖音，all=两个都要（默认 all）")
    ap.add_argument(
        "--chart",
        choices=["most_played", "bestseller", "both", "third"],
        default="most_played",
        help="榜单区块：most_played=人气，bestseller=畅销，both=人气+畅销+第三榜（畅玩/新游），third=仅第三榜",
    )
    ap.add_argument(
        "--print-max-rows",
        type=int,
        default=80,
        help="控制台打印每个完整榜的最大行数，0=不限制（默认 80）",
    )
    ap.add_argument(
        "--no-print-preview",
        action="store_true",
        help="不写控制台榜单预览（仍写 CSV）",
    )
    ap.add_argument("--rank-surge-threshold", type=int, default=10, help="异动判定：排名飙升阈值（默认10）")
    ap.add_argument(
        "--headed",
        action="store_true",
        help="有头浏览器（弹窗），便于肉眼确认是否点到各列「周榜」",
    )
    ap.add_argument(
        "--slow-mo",
        type=int,
        default=0,
        metavar="MS",
        help="每步操作延迟毫秒，建议 200～500，配合 --headed 观察点击",
    )
    ap.add_argument(
        "--debug",
        action="store_true",
        help="快捷调试：等同 --headed，并默认 slow-mo=300（可用 --slow-mo 覆盖）",
    )
    args = ap.parse_args()

    headed = bool(args.headed or args.debug)
    slow_mo = args.slow_mo if args.slow_mo > 0 else (300 if args.debug else 0)

    ref = _parse_ymd(args.monitor_date) or datetime.now().date()
    prev_monday, prev_sunday = _prev_week_range(ref)
    week_range = _week_range_str(prev_monday, prev_sunday)
    monitor_date = (args.monitor_date.strip() or datetime.now().strftime("%Y-%m-%d"))

    charts = _charts_from_arg(args.chart)
    # 仅创建本次运行会写入的子目录（人气 / 畅销 可能各一组）
    for ch in charts:
        _week_output_dir(ch, week_range).mkdir(parents=True, exist_ok=True)

    platforms: List[str] = ["wechat", "douyin"] if args.platform == "all" else [args.platform]
    limit = max(0, args.limit)

    with sync_playwright() as p:
        user_data_dir = Path(args.user_data_dir).expanduser()
        user_data_dir.mkdir(parents=True, exist_ok=True)
        ctx_kw: Dict[str, Any] = {
            "user_data_dir": str(user_data_dir),
            "headless": not headed,
            "viewport": {"width": 1920, "height": 1080},
            "locale": "zh-CN",
        }
        if slow_mo > 0:
            ctx_kw["slow_mo"] = slow_mo
        if headed:
            print(f"[*] 有头模式：可观察页面点击；slow_mo={slow_mo}ms（关闭浏览器窗口即结束进程前请等脚本跑完）")
        context = p.chromium.launch_persistent_context(**ctx_kw)
        page = context.new_page()
        page.set_default_timeout(60000)

        print(f"[*] 打开: {TARGET_URL}")
        try:
            page.goto(TARGET_URL, wait_until="load", timeout=120000)
        except PlaywrightTimeout:
            print("[!] 页面加载超时（load），继续执行")
        page.wait_for_timeout(2500)

        any_ok = False
        print_max = args.print_max_rows
        for platform in platforms:
            platform_cn = "抖音小游戏" if platform == "douyin" else "微信小游戏"
            for chart in charts:
                week_dir = _week_output_dir(chart, week_range)
                base_name = _csv_base_prefix(platform)
                board_full, board_anomaly = _board_names_for(platform, chart)
                if chart == "third":
                    chart_cn = "畅玩榜" if platform == "wechat" else "新游榜"
                elif chart == "bestseller":
                    chart_cn = "畅销榜"
                else:
                    chart_cn = "人气榜"

                print(f"\n{'='*50}")
                print(f"【{platform_cn} · {chart_cn}】→ {week_dir}")
                print(f"{'='*50}")
                results = scrape_one_platform(page, platform, limit, chart=chart)
                if not results:
                    if platform == "douyin":
                        print("[!] 未抓取到任何抖音条目")
                    elif chart == "third":
                        print("[!] 未抓取到任何微信畅玩榜条目")
                    else:
                        print("[!] 未筛选到任何【休闲】条目")
                    continue
                any_ok = True

                # 完整榜
                full_csv = week_dir / f"{base_name}_full.csv"
                write_csv(
                    results,
                    full_csv,
                    monitor_date=monitor_date,
                    platform=platform_cn,
                    source="引力引擎",
                    board_name=board_full,
                )
                print(f"✅ 完整榜：{full_csv.name}（{len(results)} 条）")

                if not args.no_print_preview:
                    preview_title = f"{platform_cn} · {chart_cn} · 完整榜（{board_full}）"
                    print_results_preview(results, preview_title, max_rows=print_max)

                # 异动榜：新进榜 或 上升/下降 > 阈值（默认 10）
                anomalies = filter_anomalies_only(results, args.rank_surge_threshold)
                anomaly_csv = week_dir / f"{base_name}_anomalies.csv"
                write_csv(
                    anomalies,
                    anomaly_csv,
                    monitor_date=monitor_date,
                    platform=platform_cn,
                    source="引力引擎",
                    board_name=board_anomaly,
                )
                print(f"✅ 异动榜：{anomaly_csv.name}（{len(anomalies)} 条，新进榜 或 上升/下降>{args.rank_surge_threshold}）")

        context.close()
        if not any_ok:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
