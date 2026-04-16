#!/usr/bin/env python3
"""
兼容入口：历史文档 / 定时任务若仍调用本文件名，会转发到竞品社媒统一脚本。

请优先使用：scripts/send_competitor_social_weekly_push.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_scripts = Path(__file__).resolve().parent
if str(_scripts) not in sys.path:
    sys.path.insert(0, str(_scripts))

from send_competitor_social_weekly_push import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
