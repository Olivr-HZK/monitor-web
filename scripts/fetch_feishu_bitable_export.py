#!/usr/bin/env python3
"""
从飞书多维表格拉取数据，导出为 CSV 和 JSON。
依赖 .env 中以 hot_ 开头的飞书热点配置：
hot_app_id、hot_app_secret、hot_app_token、hot_table_id、hot_view_id 等。
"""
import csv
import json
import os
from datetime import datetime
from pathlib import Path

import lark_oapi as lark
from lark_oapi.api.bitable.v1 import *


def _load_env_from_repo(repo_root: Path) -> None:
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


def _get_app_credentials() -> tuple[str, str]:
    """读取热点用的飞书应用凭证（hot_app_id / hot_app_secret）。"""
    app_id = os.environ.get("hot_app_id", "").strip()
    app_secret = os.environ.get("hot_app_secret", "").strip()
    if not app_id or not app_secret:
        raise RuntimeError("缺少 hot_app_id/hot_app_secret，请在 .env 中配置。")
    return app_id, app_secret


def _get_bitable_config() -> tuple[str, str, str, str, int]:
    """从环境变量读取热点多维表格访问配置（带 hot_ 前缀）。"""
    app_token = (os.environ.get("hot_app_token") or "").strip()
    table_id = (os.environ.get("hot_table_id") or "").strip()
    view_id = (os.environ.get("hot_view_id") or "").strip()
    user_id_type = (os.environ.get("hot_user_id_type") or "open_id").strip()
    page_size_raw = (os.environ.get("hot_page_size") or "").strip()

    if not app_token or not table_id or not view_id:
        raise RuntimeError("缺少 hot_app_token/hot_table_id/hot_view_id，请在 .env 中配置。")

    try:
        page_size = int(page_size_raw) if page_size_raw else 200
    except ValueError:
        page_size = 200

    return app_token, table_id, view_id, user_id_type, page_size


def _normalize_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "; ".join(_normalize_value(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _flatten_fields(fields: dict) -> dict:
    return {k: _normalize_value(v) for k, v in fields.items()}


def _write_csv(path: Path, records: list[dict]) -> None:
    if not records:
        return
    fieldnames = sorted({key for record in records for key in record.keys()})
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def main():
    repo_root = Path(__file__).resolve().parents[1]
    _load_env_from_repo(repo_root)
    app_id, app_secret = _get_app_credentials()
    app_token, table_id, view_id, user_id_type, page_size = _get_bitable_config()

    client = (
        lark.Client.builder()
        .app_id(app_id)
        .app_secret(app_secret)
        .log_level(lark.LogLevel.DEBUG)
        .build()
    )

    all_records: list[dict] = []
    page_token = ""

    while True:
        request: SearchAppTableRecordRequest = (
            SearchAppTableRecordRequest.builder()
            .app_token(app_token)
            .table_id(table_id)
            .user_id_type(user_id_type)
            .page_token(page_token)
            .page_size(page_size)
            .request_body(
                SearchAppTableRecordRequestBody.builder()
                .view_id(view_id)
                .automatic_fields(True)
                .build()
            )
            .build()
        )

        response: SearchAppTableRecordResponse = client.bitable.v1.app_table_record.search(request)

        if not response.success():
            lark.logger.error(
                "client.bitable.v1.app_table_record.search failed, "
                f"code: {response.code}, msg: {response.msg}, "
                f"log_id: {response.get_log_id()}, resp: \n"
                f"{json.dumps(json.loads(response.raw.content), indent=4, ensure_ascii=False)}"
            )
            return

        data = response.data
        records = data.items or []
        for record in records:
            fields = _flatten_fields(record.fields or {})
            fields["_record_id"] = record.record_id or ""
            fields["_created_time"] = str(record.created_time or "")
            fields["_updated_time"] = str(getattr(record, "updated_time", "") or "")
            all_records.append(fields)

        page_token = data.page_token or ""
        if not page_token:
            break

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = repo_root / "public" / "ai热点"
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"bitable_export_{timestamp}.csv"
    json_path = output_dir / f"bitable_export_{timestamp}.json"

    _write_csv(csv_path, all_records)
    json_path.write_text(json.dumps(all_records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"导出完成：{csv_path}")
    print(f"导出完成：{json_path}")


if __name__ == "__main__":
    main()
