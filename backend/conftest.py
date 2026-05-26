"""pytest 公共配置：加载 .env，注册 integration 标记。"""
from __future__ import annotations

from pathlib import Path

import pytest
from dotenv import load_dotenv

_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "integration: 调用真实大模型/API 的慢测试")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--run-integration", default=False):
        return
    skip = pytest.mark.skip(reason="默认跳过 integration；加 --run-integration 执行真实模型测试")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="运行 integration 测试（真实调用 OpenRouter 大模型）",
    )
