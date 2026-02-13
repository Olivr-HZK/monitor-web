#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

# 可选：用 .env 中 hot_app_id/hot_app_secret 换取封面临时下载链接
try:
    import lark_oapi as lark
    from lark_oapi.api.drive.v1 import BatchGetTmpDownloadUrlMediaRequest
    _HAS_LARK = True
except ImportError:
    _HAS_LARK = False


def _load_env_from_repo(repo_root: Path) -> None:
    """从项目根目录的 .env 加载环境变量（与 test.py 一致）。"""
    env_path = repo_root / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        if key and key not in os.environ:
            os.environ[key] = value


def _get_app_credentials() -> tuple[str, str] | None:
    """从环境变量读取热点用的 hot_app_id、hot_app_secret；若未配置则返回 None。"""
    app_id = (os.environ.get("hot_app_id") or "").strip()
    app_secret = (os.environ.get("hot_app_secret") or "").strip()
    if not app_id or not app_secret:
        return None
    return app_id, app_secret


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def _parse_bool(value: str | None) -> bool | None:
    if value is None:
        return None
    raw = str(value).strip().lower()
    if raw in {"true", "1", "yes"}:
        return True
    if raw in {"false", "0", "no"}:
        return False
    return None


def _extract_between(text: str, start_markers: list[str], end_markers: list[str]) -> str:
    if not text:
        return ""
    start_idx = None
    start_marker = ""
    for marker in start_markers:
        idx = text.find(marker)
        if idx != -1 and (start_idx is None or idx < start_idx):
            start_idx = idx
            start_marker = marker
    if start_idx is None:
        return ""
    tail = text[start_idx + len(start_marker):]
    tail = tail.lstrip("：: \n\r\t")
    end_idx = None
    for marker in end_markers:
        idx = tail.find(marker)
        if idx != -1 and (end_idx is None or idx < end_idx):
            end_idx = idx
    segment = tail if end_idx is None else tail[:end_idx]
    return segment.strip()


def _compact_summary(text: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) > limit:
        return compact[:limit] + "..."
    return compact


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y/%m/%d %H:%M", "%Y-%m-%d %H:%M", "%Y/%m/%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _extract_bitable_cell(value: str | None, prefer_link: bool = False) -> str:
    """从飞书 Bitable 导出的单元格 JSON 中提取纯文本或链接。"""
    if not value:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    # 可能是多个 JSON 对象用 "; " 拼接（如部分 视频分析）
    parts = raw.split("; ")
    texts: list[str] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        try:
            obj = json.loads(part)
        except (json.JSONDecodeError, TypeError):
            if not texts:
                return raw
            continue
        if not isinstance(obj, dict):
            if not texts:
                return raw
            continue
        if prefer_link and obj.get("link"):
            return str(obj["link"]).strip()
        if "text" in obj:
            texts.append(str(obj["text"]).strip())
        elif prefer_link and obj.get("link"):
            texts.append(str(obj["link"]).strip())
    if texts:
        return "\n".join(texts) if len(texts) > 1 else texts[0]
    return raw


def _extract_bitable_cover(value: str | None) -> tuple[str | None, str | None]:
    """从飞书 Bitable 导出的「视频封面」单元格中提取 (url, file_token)。"""
    if not value:
        return None, None
    raw = str(value).strip()
    if not raw:
        return None, None
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None, None
    if not isinstance(obj, dict):
        return None, None
    url = (obj.get("url") or obj.get("tmp_url")) or None
    file_token = obj.get("file_token") or None
    return url, file_token


def _batch_get_cover_tmp_urls(
    client: "lark.Client", file_tokens: list[str]
) -> dict[str, str]:
    """批量获取飞书媒体临时下载链接，返回 file_token -> tmp_download_url 映射。"""
    if not _HAS_LARK or not file_tokens:
        return {}
    token_set = list(dict.fromkeys(file_tokens))
    try:
        request = (
            BatchGetTmpDownloadUrlMediaRequest.builder()
            .file_tokens(token_set)
            .build()
        )
        response = client.drive.v1.media.batch_get_tmp_download_url(request)
        if not response.success() or not response.data or not response.data.tmp_download_urls:
            return {}
        return {
            item.file_token: item.tmp_download_url
            for item in response.data.tmp_download_urls
            if getattr(item, "file_token", None) and getattr(item, "tmp_download_url", None)
        }
    except Exception:
        return {}


def convert_csv_to_json(csv_path: Path, lark_client: Any = None) -> dict[str, Any]:
    documents: list[dict[str, Any]] = []
    time_candidates: list[datetime] = []
    cover_file_tokens: list[tuple[int, str]] = []  # (doc_index, file_token)

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = _extract_bitable_cell(row.get("视频标题"))
            url = _extract_bitable_cell(row.get("视频地址"), prefer_link=True)
            summary_block = _extract_bitable_cell(row.get("视频总结"))
            analysis_block = _extract_bitable_cell(row.get("视频分析"))

            ua_text = _extract_between(
                analysis_block,
                ["二、推荐玩法（转化为AI特效/模板）", "二、推荐玩法"],
                ["三、数据情况（仅限输入提供）", "三、数据情况", "三、数据情况（仅限输入提供）"],
            )

            content_parts: list[str] = []
            if summary_block:
                content_parts.append(f"## 摘要\n\n{summary_block}")
            if ua_text:
                content_parts.append(f"## UA灵感\n\n{ua_text}")
            if url:
                content_parts.append(f"## 原文链接\n\n{url}")
            content = "\n\n".join(content_parts).strip()

            score = _parse_int(row.get("AI评分"))
            views = _parse_int(row.get("播放量"))
            likes = _parse_int(row.get("点赞量"))
            region = _extract_bitable_cell(row.get("发布地区"))
            source = _extract_bitable_cell(row.get("来源"))
            is_ad = _parse_bool(_extract_bitable_cell(row.get("是否广告")))
            video_id = _extract_bitable_cell(row.get("视频编号"))
            published_at = (row.get("发布日期") or "").strip()
            captured_at = (row.get("时间戳") or "").strip()

            record_match = re.search(r"record_id[:：]\s*([A-Za-z0-9_-]+)", analysis_block)
            record_id = record_match.group(1) if record_match else None

            if captured_at:
                dt = _parse_datetime(captured_at)
                if dt:
                    time_candidates.append(dt)

            tags = ["TikTok", "热点"]
            if region:
                tags.append(region)

            cover_url, cover_file_token = _extract_bitable_cover(row.get("视频封面"))
            if lark_client and cover_file_token:
                cover_file_tokens.append((len(documents), cover_file_token))

            doc: dict[str, Any] = {
                "title": title or "未命名热点",
                "content": content or summary_block or "暂无内容",
                "tags": tags,
                "summary": _compact_summary(summary_block or title or ""),
                "score": score,
                "meta": {
                    "url": url or None,
                    "views": views,
                    "likes": likes,
                    "video_id": video_id or None,
                    "record_id": record_id,
                    "region": region or None,
                    "source": source or None,
                    "cover_url": cover_url,
                    "published_at": published_at or None,
                    "captured_at": captured_at or None,
                    "is_ad": is_ad,
                },
            }

            documents.append(doc)

    if lark_client and cover_file_tokens:
        all_tokens = [ft for _, ft in cover_file_tokens]
        token_to_url = _batch_get_cover_tmp_urls(lark_client, all_tokens)
        for idx, ft in cover_file_tokens:
            if ft in token_to_url:
                documents[idx]["meta"]["cover_url"] = token_to_url[ft]

    if time_candidates:
        generated_at = max(time_candidates).strftime("%Y-%m-%dT%H:%M:%S")
    else:
        generated_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    return {"generated_at": generated_at, "feishu": {"documents": documents}}


def main() -> int:
    parser = argparse.ArgumentParser(description="将 TikTok 多维表格 CSV 转为热点趋势 JSON")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("public/热点/tiktoktrending_base_Table_tiktok_record.csv"),
        help="CSV 输入路径",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="JSON 输出路径（与 --output-dir 二选一）",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="输出目录：将按 generated_at 命名生成 JSON，如 2026-02-12T14-20-26.json",
    )
    args = parser.parse_args()

    input_path = args.input
    if not input_path.exists():
        print(f"输入文件不存在：{input_path}")
        return 1

    repo_root = Path(__file__).resolve().parents[1]
    _load_env_from_repo(repo_root)
    credentials = _get_app_credentials()
    lark_client = None
    if _HAS_LARK and credentials:
        app_id, app_secret = credentials
        lark_client = (
            lark.Client.builder()
            .app_id(app_id)
            .app_secret(app_secret)
            .build()
        )

    result = convert_csv_to_json(input_path, lark_client=lark_client)
    if args.output_dir is not None:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        safe_name = result["generated_at"].replace(":", "-") + ".json"
        output_path = args.output_dir / safe_name
    else:
        output_path = args.output or Path("public/热点/final_json_from_csv.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成：{output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
