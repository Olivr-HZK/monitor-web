#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Puzzle Game 周报 AI 验证门禁。

验证结果只保存到本地 output/weekly_validations/，不对接外部系统。
"""

import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from datetime import datetime, timedelta

import requests


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_RSS_DB_DIR = PROJECT_ROOT / "output" / "rss"
VALIDATION_OUTPUT_DIR = PROJECT_ROOT / "output" / "weekly_validations"
ARTICLE_CACHE_DIR = PROJECT_ROOT / "output" / "validation_cache" / "articles"
DEFAULT_ALLOWED_FEEDS = ("mobilegamer", "gamesindustry", "pocketgamer-biz")
DEFAULT_MODEL = "qwen/qwen3.7-max"
AI_VALIDATION_API_BASE = os.environ.get("AI_VALIDATION_API_BASE", "https://openrouter.ai/api/v1")
AI_VALIDATION_MAX_OUTPUT_TOKENS = int(os.environ.get("AI_VALIDATION_MAX_OUTPUT_TOKENS", "12000"))
DEFAULT_GENERATOR_CANDIDATE_LIMIT = int(os.environ.get("WEEKLY_GENERATION_CANDIDATE_LIMIT", "180"))
ARTICLE_CACHE_TTL_SECONDS = 24 * 60 * 60
ARTICLE_FETCH_TIMEOUT = 12
ARTICLE_TEXT_LIMIT = 3500
OMISSION_TITLE_LIMIT = 180


class _ArticleTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "nav", "footer", "header", "aside", "noscript", "svg"}:
            self.skip_depth += 1
        if tag in {"p", "br", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "nav", "footer", "header", "aside", "noscript", "svg"} and self.skip_depth:
            self.skip_depth -= 1
        if tag in {"p", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.skip_depth:
            return
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self):
        raw = " ".join(self.parts)
        raw = html.unescape(raw)
        raw = re.sub(r"\s+", " ", raw)
        return raw.strip()


def _now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _short_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _parse_datetime(value):
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    candidates = [text]
    if text.endswith("Z"):
        candidates.append(text[:-1] + "+00:00")
    if " " in text and "T" not in text:
        candidates.append(text.replace(" ", "T", 1))
    for candidate in candidates:
        try:
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is not None:
                dt = dt.astimezone().replace(tzinfo=None)
            return dt
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _snapshot_window(payload):
    window = payload.get("date_window") or {}
    start_dt = _parse_datetime(window.get("start"))
    end_dt = _parse_datetime(window.get("end_exclusive"))
    if start_dt and end_dt:
        return start_dt, end_dt, window

    generated = _parse_datetime(payload.get("generated_at")) or datetime.now()
    start_date = generated.date() - timedelta(days=7)
    end_date = generated.date() + timedelta(days=1)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.min.time())
    return start_dt, end_dt, {
        "timezone": "Asia/Shanghai",
        "start": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "end_exclusive": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "inferred": True,
    }


def _validation_path_for_snapshot(snapshot_path):
    VALIDATION_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return VALIDATION_OUTPUT_DIR / f"weekly_validation_{Path(snapshot_path).stem}.json"


def _load_snapshot(snapshot_path):
    path = Path(snapshot_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["_snapshot_path"] = str(path)
    if "news_list" not in payload:
        payload["news_list"] = payload.get("news_preview", [])
    return payload


def _extract_report_items(report_text):
    items = []
    current_heading = ""
    for line_no, raw_line in enumerate((report_text or "").splitlines(), 1):
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("**"):
            current_heading = line
            continue
        refs = []
        for match in re.findall(r"\[#(\d+)\]", line):
            try:
                refs.append(int(match))
            except ValueError:
                continue
        if refs:
            items.append({
                "line_no": line_no,
                "section": current_heading,
                "text": line,
                "refs": refs,
            })
    return items


def _referenced_indices(*reports):
    refs = set()
    for report in reports:
        for match in re.findall(r"\[#(\d+)\]", report or ""):
            try:
                refs.add(int(match) - 1)
            except ValueError:
                continue
    return refs


def _fetch_article_text(url):
    ARTICLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = ARTICLE_CACHE_DIR / f"{_short_hash(url)}.json"
    if cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            fetched_at = cached.get("fetched_at_epoch", 0)
            if time.time() - fetched_at < ARTICLE_CACHE_TTL_SECONDS:
                return cached
        except Exception:
            pass

    result = {
        "url": url,
        "fetched_at": _now_iso(),
        "fetched_at_epoch": time.time(),
        "ok": False,
        "status_code": None,
        "text": "",
        "error": "",
    }
    try:
        response = requests.get(
            url,
            timeout=ARTICLE_FETCH_TIMEOUT,
            headers={"User-Agent": "gaming-weekly-validator/1.0"},
        )
        result["status_code"] = response.status_code
        response.raise_for_status()
        parser = _ArticleTextParser()
        parser.feed(response.text)
        result["text"] = parser.text()[:ARTICLE_TEXT_LIMIT]
        result["ok"] = bool(result["text"])
    except Exception as exc:
        result["error"] = str(exc)

    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def _load_candidate_titles(rss_db_dir, start_dt, end_dt, allowed_feeds):
    rows = []
    db_dir = Path(rss_db_dir)
    if not db_dir.exists():
        return rows
    for db_path in sorted(db_dir.glob("*.db"), reverse=True):
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT title, url, feed_id, published_at, summary
                FROM rss_items
                ORDER BY published_at DESC
                """
            )
            for title, url, feed_id, published_at, summary in cursor.fetchall():
                if feed_id not in allowed_feeds:
                    continue
                pub_dt = _parse_datetime(published_at)
                if pub_dt and start_dt <= pub_dt < end_dt:
                    rows.append({
                        "title": title or "",
                        "url": url or "",
                        "feed_id": feed_id or "",
                        "published_at": published_at or "",
                        "summary": summary or "",
                    })
            conn.close()
        except Exception:
            continue

    seen = set()
    deduped = []
    for row in rows:
        key = row["url"] or row["title"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _candidate_titles_from_generator_payload(payload, start_dt, end_dt, allowed_feeds):
    news_list = payload.get("news_list") or []
    limit = payload.get("generator_candidate_limit")
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = DEFAULT_GENERATOR_CANDIDATE_LIMIT
    if limit <= 0:
        limit = DEFAULT_GENERATOR_CANDIDATE_LIMIT

    rows = []
    for item in news_list[:limit]:
        feed_id = item.get("source") or item.get("feed_id") or ""
        if feed_id not in allowed_feeds:
            continue
        pub_dt = _parse_datetime(item.get("date") or item.get("published_at"))
        if pub_dt and not (start_dt <= pub_dt < end_dt):
            continue
        rows.append({
            "title": item.get("title") or "",
            "url": item.get("link") or item.get("url") or "",
            "feed_id": feed_id,
            "published_at": item.get("date") or item.get("published_at") or "",
            "summary": item.get("summary") or "",
        })
    return rows


def _status_from_issues(issues):
    return "fail" if issues else "pass"


def _deterministic_checks(payload, allowed_feeds, rss_db_dir):
    reports = payload.get("reports") or {}
    report_zh = reports.get("zh") or ""
    report_en = reports.get("en") or ""
    news_list = payload.get("news_list") or []
    start_dt, end_dt, window = _snapshot_window(payload)
    refs = _referenced_indices(report_zh, report_en)

    time_source_issues = []
    checked_refs = []
    for idx in sorted(refs):
        ref_num = idx + 1
        if idx < 0 or idx >= len(news_list):
            time_source_issues.append({
                "ref": ref_num,
                "reason": "reference_out_of_range",
                "detail": f"[#{ref_num}] 不在 news_list 范围内",
            })
            continue
        item = news_list[idx]
        checked_refs.append(ref_num)
        feed_id = item.get("source") or item.get("feed_id") or ""
        pub_dt = _parse_datetime(item.get("date") or item.get("published_at"))
        if feed_id not in allowed_feeds:
            time_source_issues.append({
                "ref": ref_num,
                "reason": "source_not_allowed",
                "feed_id": feed_id,
                "title": item.get("title", ""),
                "url": item.get("link", ""),
            })
        if pub_dt is None or not (start_dt <= pub_dt < end_dt):
            time_source_issues.append({
                "ref": ref_num,
                "reason": "published_at_out_of_window",
                "published_at": item.get("date") or item.get("published_at"),
                "title": item.get("title", ""),
                "url": item.get("link", ""),
            })

    en_issues = []
    if re.search(r"[\u4e00-\u9fff]", report_en):
        en_issues.append({"reason": "english_report_contains_chinese"})
    if "查看原文" in report_en:
        en_issues.append({"reason": "english_report_contains_chinese_link_label"})

    zh_rule_warnings = []
    obvious_english_sentences = re.findall(r"[A-Za-z][A-Za-z ,;:'\"()/-]{45,}[.!?]", report_zh)
    if obvious_english_sentences:
        zh_rule_warnings.append({
            "reason": "possible_long_english_sentence_in_zh",
            "samples": obvious_english_sentences[:5],
        })

    candidate_titles = _candidate_titles_from_generator_payload(payload, start_dt, end_dt, allowed_feeds)
    if not candidate_titles:
        candidate_titles = _load_candidate_titles(rss_db_dir, start_dt, end_dt, allowed_feeds)
    return {
        "window": window,
        "checked_reference_numbers": checked_refs,
        "time_source": {
            "status": _status_from_issues(time_source_issues),
            "issues": time_source_issues,
        },
        "english_purity": {
            "status": _status_from_issues(en_issues),
            "issues": en_issues,
        },
        "zh_rule_warnings": zh_rule_warnings,
        "candidate_titles": candidate_titles,
    }


def _build_fact_context(payload):
    reports = payload.get("reports") or {}
    report_items = _extract_report_items(reports.get("zh") or "")
    news_list = payload.get("news_list") or []
    contexts = []
    seen_urls = {}
    for item in report_items:
        ref_contexts = []
        for ref_num in item["refs"]:
            idx = ref_num - 1
            if not (0 <= idx < len(news_list)):
                continue
            news = news_list[idx]
            url = news.get("link") or ""
            article = seen_urls.get(url)
            if article is None:
                article = _fetch_article_text(url) if url else {"ok": False, "text": "", "error": "missing_url"}
                seen_urls[url] = article
            evidence = article.get("text") or (news.get("summary") or "")
            ref_contexts.append({
                "ref": ref_num,
                "title": news.get("title", ""),
                "url": url,
                "source": news.get("source", ""),
                "published_at": news.get("date", ""),
                "rss_summary": news.get("summary", ""),
                "article_fetch_ok": bool(article.get("ok")),
                "article_text_or_fallback": evidence[:ARTICLE_TEXT_LIMIT],
            })
        contexts.append({
            "line_no": item["line_no"],
            "section": item["section"],
            "analysis_text": item["text"],
            "references": ref_contexts,
        })
    return contexts


def _top3_refs(report_zh):
    refs = []
    in_top3 = False
    for raw_line in (report_zh or "").splitlines():
        line = raw_line.strip()
        if line.startswith("**🔥"):
            in_top3 = True
            continue
        if in_top3 and line.startswith("**"):
            break
        if in_top3:
            refs.extend(int(x) for x in re.findall(r"\[#(\d+)\]", line))
    return refs


def _ai_schema():
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "fact_trust",
            "key_omissions",
            "zh_localization",
            "en_localization",
            "blocking_issues",
            "warnings",
        ],
        "properties": {
            "fact_trust": {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "checks"],
                "properties": {
                    "status": {"type": "string", "enum": ["pass", "fail"]},
                    "checks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["line_no", "verdict", "reason", "evidence_urls"],
                            "properties": {
                                "line_no": {"type": "integer"},
                                "verdict": {
                                    "type": "string",
                                    "enum": ["supported", "partially_supported", "unsupported", "not_enough_evidence"],
                                },
                                "reason": {"type": "string"},
                                "evidence_urls": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                    },
                },
            },
            "key_omissions": {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "critical_missing_items", "top3_issues"],
                "properties": {
                    "status": {"type": "string", "enum": ["pass", "fail"]},
                    "critical_missing_items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["title", "url", "reason"],
                            "properties": {
                                "title": {"type": "string"},
                                "url": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                        },
                    },
                    "top3_issues": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["issue", "reason"],
                            "properties": {
                                "issue": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                        },
                    },
                },
            },
            "zh_localization": {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "issues"],
                "properties": {
                    "status": {"type": "string", "enum": ["pass", "fail"]},
                    "issues": {"type": "array", "items": {"type": "string"}},
                },
            },
            "en_localization": {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "issues"],
                "properties": {
                    "status": {"type": "string", "enum": ["pass", "fail"]},
                    "issues": {"type": "array", "items": {"type": "string"}},
                },
            },
            "blocking_issues": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
        },
    }


def _extract_chat_message_text(response_payload):
    choices = response_payload.get("choices")
    if not choices:
        raise ValueError(f"Chat Completions API 响应中缺少 choices: {json.dumps(response_payload, ensure_ascii=False)[:1000]}")

    message = choices[0].get("message") or {}
    parsed = message.get("parsed")
    if isinstance(parsed, (dict, list)):
        return json.dumps(parsed, ensure_ascii=False)
    if isinstance(parsed, str) and parsed.strip():
        return parsed

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, dict):
                    text = text.get("value") or text.get("text")
                if isinstance(text, str):
                    parts.append(text)
        joined = "".join(parts).strip()
        if joined:
            return joined

    raise ValueError("Chat Completions API 响应中缺少可解析文本")


def _parse_validation_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
            stripped = re.sub(r"\s*```$", "", stripped)
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and start < end:
            return json.loads(stripped[start:end + 1])
        raise


def _default_ai_dimension(key, status="fail"):
    defaults = {
        "fact_trust": {"status": status, "checks": []},
        "key_omissions": {"status": status, "critical_missing_items": [], "top3_issues": []},
        "zh_localization": {"status": status, "issues": []},
        "en_localization": {"status": status, "issues": []},
    }
    return defaults[key]


def _as_string_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _simplified_validation_to_dimensions(is_pass, reason="", errors=None):
    status = "pass" if is_pass else "fail"
    normalized = {
        "fact_trust": {"status": "pass", "checks": []},
        "key_omissions": {
            "status": "pass",
            "critical_missing_items": [],
            "top3_issues": [],
        },
        "zh_localization": {"status": "pass", "issues": []},
        "en_localization": {"status": "pass", "issues": []},
        "blocking_issues": [],
        "warnings": [],
    }
    if is_pass:
        if reason:
            normalized["warnings"].append(reason)
        return normalized

    normalized["blocking_issues"].append("ai_validation_failed")
    if reason:
        normalized["warnings"].append(reason)

    parsed_errors = errors if isinstance(errors, list) else []
    if not parsed_errors and reason:
        parsed_errors = [{"type": "validation_reason", "description": reason}]
    if not parsed_errors:
        for key in ("fact_trust", "key_omissions", "zh_localization", "en_localization"):
            normalized[key]["status"] = status
        return normalized

    for item in parsed_errors:
        if isinstance(item, dict):
            issue_type = str(item.get("type") or item.get("issue") or "").lower()
            description = str(
                item.get("description")
                or item.get("details")
                or item.get("reason")
                or item
            ).strip()
        else:
            issue_type = ""
            description = str(item).strip()
        combined = f"{issue_type} {description}".lower()
        if "omitted" in combined or "omission" in combined or "top3" in combined or "top 3" in combined:
            normalized["key_omissions"]["status"] = "fail"
            normalized["key_omissions"]["critical_missing_items"].append({
                "title": "",
                "url": "",
                "reason": description,
            })
        elif "chinese" in combined or "zh" in combined or "中文" in combined:
            normalized["zh_localization"]["status"] = "fail"
            normalized["zh_localization"]["issues"].append(description)
        elif "english" in combined or "en_" in combined or "英文" in combined:
            normalized["en_localization"]["status"] = "fail"
            normalized["en_localization"]["issues"].append(description)
        else:
            normalized["fact_trust"]["status"] = "fail"
            normalized["fact_trust"]["checks"].append({
                "line_no": 0,
                "verdict": "unsupported",
                "reason": description,
                "evidence_urls": [],
            })
    return normalized


def _normalize_ai_validation_result(parsed, missing_dimensions_are_warnings=False):
    if not isinstance(parsed, dict):
        raise ValueError("AI 验证结果不是 JSON object")

    required = ("fact_trust", "key_omissions", "zh_localization", "en_localization")
    simplified_status = parsed.get("is_pass")
    if simplified_status is None:
        simplified_status = parsed.get("is_valid")
    if simplified_status is None:
        simplified_status = parsed.get("status") or parsed.get("overall_status")
    if simplified_status is not None and not any(key in parsed for key in required):
        if isinstance(simplified_status, str):
            is_pass = simplified_status.strip().lower() in {"pass", "passed", "true", "ok", "success"}
        else:
            is_pass = bool(simplified_status)
        reason = str(parsed.get("reason") or "").strip()
        return _simplified_validation_to_dimensions(
            is_pass=is_pass,
            reason=reason,
            errors=parsed.get("errors"),
        )

    candidate = parsed
    for wrapper_key in ("dimensions", "validation", "result"):
        wrapped = parsed.get(wrapper_key)
        if isinstance(wrapped, dict) and any(key in wrapped for key in required):
            candidate = wrapped
            break

    normalized = {
        "blocking_issues": _as_string_list(
            parsed.get("blocking_issues") or candidate.get("blocking_issues")
        ),
        "warnings": _as_string_list(
            parsed.get("warnings") or candidate.get("warnings")
        ),
    }
    missing = []
    for key in required:
        value = candidate.get(key)
        if isinstance(value, dict):
            normalized[key] = value
        else:
            missing_status = "pass" if missing_dimensions_are_warnings else "fail"
            normalized[key] = _default_ai_dimension(key, status=missing_status)
            missing.append(key)

    if missing:
        if not missing_dimensions_are_warnings:
            normalized["blocking_issues"].append(
                "ai_validation_schema_missing:" + ",".join(missing)
            )
        normalized["warnings"].append(
            "AI validation response missed required top-level keys: "
            + ", ".join(missing)
            + (
                "; missing dimensions treated as inconclusive after retries"
                if missing_dimensions_are_warnings
                else ""
            )
        )

    normalized["blocking_issues"] = list(dict.fromkeys(normalized["blocking_issues"]))
    normalized["warnings"] = list(dict.fromkeys(normalized["warnings"]))
    return normalized


def _schema_missing_issues(normalized):
    return [
        issue
        for issue in normalized.get("blocking_issues", [])
        if str(issue).startswith("ai_validation_schema_missing:")
    ]


def _call_ai_validation(api_key, model, fact_context, candidate_titles, payload, deterministic, allowed_feeds):
    if not api_key:
        raise ValueError("未配置 AI_VALIDATION_API_KEY、OPENROUTER_API_KEY 或 AI_API_KEY")

    reports = payload.get("reports") or {}
    news_list = payload.get("news_list") or []
    selected_urls = set()
    for idx in _referenced_indices(reports.get("zh") or "", reports.get("en") or ""):
        if 0 <= idx < len(news_list):
            url = news_list[idx].get("link") or ""
            if url:
                selected_urls.add(url)
    compact_titles = candidate_titles[:OMISSION_TITLE_LIMIT]
    user_payload = {
        "date_window": deterministic["window"],
        "allowed_feeds": list(allowed_feeds),
        "top3_refs": _top3_refs(reports.get("zh") or ""),
        "selected_report_urls": sorted(selected_urls)[:250],
        "report_zh": reports.get("zh", ""),
        "report_en": reports.get("en", ""),
        "fact_checks_to_review": fact_context,
        "candidate_titles_from_allowed_feeds": compact_titles,
    }
    system = (
        "You are a strict QA validator for a weekly mobile puzzle/casual games market report. "
        "Return JSON only using the provided schema. Fail only for material issues: unsupported factual claims, "
        "critical omitted puzzle/casual competitor news, wrong Top 3 priority, bad Chinese localization, or Chinese in English. "
        "Treat company names, game names, and technical terms such as Puzzle, Match-3, Merge, CPI, ROAS, LTV, DAU, MAU as allowed in Chinese text."
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    json_schema = {
        "name": "weekly_report_validation",
        "strict": True,
        "schema": _ai_schema(),
    }
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]
    api_base = AI_VALIDATION_API_BASE.rstrip("/")
    url = f"{api_base}/chat/completions"
    data = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": AI_VALIDATION_MAX_OUTPUT_TOKENS,
        "response_format": {
            "type": "json_schema",
            "json_schema": json_schema,
        },
    }

    last_error = None
    for attempt in range(3):
        try:
            response = requests.post(url, headers=headers, json=data, timeout=180)
            if not response.ok:
                try:
                    error_body = json.dumps(response.json(), ensure_ascii=False)
                except ValueError:
                    error_body = response.text
                raise RuntimeError(
                    f"AI 验证 API 请求失败: status={response.status_code}; body={error_body[:2000]}"
                )
            raw = response.json()
            response_text = _extract_chat_message_text(raw)
            parsed = _parse_validation_json(response_text)
            normalized = _normalize_ai_validation_result(parsed)
            schema_missing = _schema_missing_issues(normalized)
            if schema_missing and attempt < 2:
                messages.extend([
                    {"role": "assistant", "content": response_text},
                    {
                        "role": "user",
                        "content": (
                            "Your previous JSON missed required validation dimensions: "
                            + ", ".join(schema_missing)
                            + ". Return JSON only and include every required top-level key from the schema: "
                            "fact_trust, key_omissions, zh_localization, en_localization, blocking_issues, warnings."
                        ),
                    },
                ])
                data["messages"] = messages
                last_error = RuntimeError("; ".join(schema_missing))
                time.sleep(2 + attempt)
                continue
            if schema_missing:
                normalized = _normalize_ai_validation_result(
                    parsed,
                    missing_dimensions_are_warnings=True,
                )
            return normalized, raw.get("usage", {})
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 + attempt)
    raise last_error


def validate_snapshot(snapshot_path, api_key=None, model=DEFAULT_MODEL, rss_db_dir=None, allowed_feeds=None):
    snapshot = Path(snapshot_path)
    payload = _load_snapshot(snapshot)
    allowed_feeds = tuple(allowed_feeds or DEFAULT_ALLOWED_FEEDS)
    rss_db_dir = rss_db_dir or payload.get("rss_db_dir") or str(DEFAULT_RSS_DB_DIR)
    snapshot_sha = _sha256_file(snapshot)
    deterministic = _deterministic_checks(payload, allowed_feeds, rss_db_dir)
    fact_context = _build_fact_context(payload)

    blocking_issues = []
    if deterministic["time_source"]["status"] == "fail":
        blocking_issues.append("time_source_failed")
    if deterministic["english_purity"]["status"] == "fail":
        blocking_issues.append("english_purity_failed")

    ai_result = None
    ai_error = None
    usage = {}
    if blocking_issues:
        ai_error = "deterministic_checks_failed_before_ai"
    else:
        try:
            ai_key = (
                api_key
                or os.environ.get("AI_VALIDATION_API_KEY")
                or os.environ.get("OPENROUTER_API_KEY")
                or os.environ.get("AI_API_KEY")
            )
            ai_result, usage = _call_ai_validation(
                api_key=ai_key,
                model=model,
                fact_context=fact_context,
                candidate_titles=deterministic["candidate_titles"],
                payload=payload,
                deterministic=deterministic,
                allowed_feeds=allowed_feeds,
            )
        except Exception as exc:
            ai_error = str(exc)
            blocking_issues.append("ai_validation_error")

    dimensions = {
        "time_source": deterministic["time_source"],
        "english_purity": deterministic["english_purity"],
        "fact_trust": {"status": "fail", "checks": []},
        "key_omissions": {"status": "fail", "critical_missing_items": [], "top3_issues": []},
        "zh_localization": {"status": "fail", "issues": []},
        "en_localization": {"status": "fail", "issues": []},
    }
    warnings = list(deterministic.get("zh_rule_warnings") or [])
    if ai_result:
        for key in ("fact_trust", "key_omissions", "zh_localization", "en_localization"):
            dimensions[key] = ai_result[key]
            if ai_result[key].get("status") == "fail":
                blocking_issues.append(f"{key}_failed")
        warnings.extend(ai_result.get("warnings") or [])

    blocking_issues.extend((ai_result or {}).get("blocking_issues") or [])
    blocking_issues = list(dict.fromkeys(blocking_issues))
    overall_status = "fail" if blocking_issues else "pass"

    validation_path = _validation_path_for_snapshot(snapshot)
    result = {
        "schema_version": "1.0",
        "created_at": _now_iso(),
        "overall_status": overall_status,
        "snapshot_path": str(snapshot),
        "snapshot_sha256": snapshot_sha,
        "validation_result_path": str(validation_path.resolve()),
        "model": model,
        "allowed_feeds": list(allowed_feeds),
        "rss_db_dir": str(rss_db_dir),
        "date_window": deterministic["window"],
        "checked_reference_numbers": deterministic["checked_reference_numbers"],
        "token_usage": usage,
        "dimensions": dimensions,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
        "ai_error": ai_error,
    }
    validation_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"验证结果已保存: {validation_path.resolve()}")
    return result


def ensure_snapshot_valid(snapshot_path, api_key=None, model=DEFAULT_MODEL, rss_db_dir=None, allowed_feeds=None):
    snapshot = Path(snapshot_path)
    validation_path = _validation_path_for_snapshot(snapshot)
    snapshot_sha = _sha256_file(snapshot)
    if validation_path.exists():
        try:
            existing = json.loads(validation_path.read_text(encoding="utf-8"))
            if existing.get("snapshot_sha256") == snapshot_sha and existing.get("model") == model:
                if existing.get("ai_error"):
                    print(f"忽略带验证执行错误的本地结果，重新验证: {validation_path.resolve()}")
                    return validate_snapshot(
                        snapshot_path=snapshot,
                        api_key=api_key,
                        model=model,
                        rss_db_dir=rss_db_dir,
                        allowed_feeds=allowed_feeds,
                    )
                blocking_issues = existing.get("blocking_issues") or []
                if any(str(issue).startswith("ai_validation_schema_missing:") for issue in blocking_issues):
                    print(f"忽略旧 schema 解析失败的本地结果，重新验证: {validation_path.resolve()}")
                    return validate_snapshot(
                        snapshot_path=snapshot,
                        api_key=api_key,
                        model=model,
                        rss_db_dir=rss_db_dir,
                        allowed_feeds=allowed_feeds,
                    )
                print(f"复用本地验证结果: {validation_path.resolve()}")
                print(f"验证结果已保存: {validation_path.resolve()}")
                return existing
        except Exception:
            pass
    return validate_snapshot(
        snapshot_path=snapshot,
        api_key=api_key,
        model=model,
        rss_db_dir=rss_db_dir,
        allowed_feeds=allowed_feeds,
    )


def main():
    parser = argparse.ArgumentParser(description="验证 Puzzle Game 周报快照")
    parser.add_argument("snapshot", help="周报快照 JSON 路径")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="验证模型，默认 qwen/qwen3.7-max")
    args = parser.parse_args()
    result = validate_snapshot(args.snapshot, model=args.model)
    return 0 if result.get("overall_status") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
