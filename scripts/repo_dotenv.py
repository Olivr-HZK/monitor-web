# -*- coding: utf-8 -*-
"""为 scripts 加载环境变量：优先项目根目录 .env，再补充 backend/.env（不覆盖根目录已有项）。

飞书 ST 列式图标上传需要 FEISHU_APP_ID / FEISHU_APP_SECRET；若只写在 backend/.env，仅加载根 .env 时会导致无图标。
"""

from __future__ import annotations

import os
from pathlib import Path


def load_repo_env(repo_root: Path) -> None:
    repo_root = repo_root.resolve()
    root_env = repo_root / ".env"
    backend_env = repo_root / "backend" / ".env"

    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None

    if load_dotenv is not None:
        if root_env.is_file():
            load_dotenv(root_env)
        if backend_env.is_file():
            load_dotenv(backend_env, override=False)
        return

    for path in (root_env, backend_env):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if v.startswith('"') and v.endswith('"'):
                v = v[1:-1]
            elif v.startswith("'") and v.endswith("'"):
                v = v[1:-1]
            os.environ.setdefault(k, v)
