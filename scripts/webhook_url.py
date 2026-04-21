# -*- coding: utf-8 -*-
"""将 Webhook URL 规范为 http.client 可发送的 ASCII URI。

若 .env 中 URL 误混入全角标点（如顿号 \u3001），或 query 中含非 ASCII，
urllib 在构造 HTTP 请求行时会触发 UnicodeEncodeError。
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit


def normalize_webhook_url(url: str) -> str:
    if not url:
        return url
    s = url.strip().replace("\r", "").replace("\n", "")
    if not s:
        return s
    try:
        s.encode("ascii")
        return s
    except UnicodeEncodeError:
        pass

    u = urlsplit(s)
    scheme = (u.scheme or "https").strip()
    netloc = _normalize_netloc(u.netloc)
    path = quote(u.path or "/", safe="/")
    query = ""
    if u.query:
        pairs = parse_qsl(u.query, keep_blank_values=True)
        query = urlencode(pairs, doseq=True, quote_via=quote)
    fragment = quote(u.fragment, safe="") if u.fragment else ""
    return urlunsplit((scheme, netloc, path, query, fragment))


def _normalize_netloc(netloc: str) -> str:
    if not netloc:
        return netloc
    if netloc.isascii():
        return netloc

    userinfo, _, hostport = netloc.rpartition("@")
    if not hostport:
        hostport = userinfo
        userinfo = ""

    # IPv6 [addr]:port
    if hostport.startswith("["):
        return f"{userinfo}@{hostport}" if userinfo else hostport

    # host:port（port 为纯数字）
    if ":" in hostport:
        idx = hostport.rfind(":")
        maybe_port = hostport[idx + 1 :]
        if maybe_port.isdigit():
            host, port = hostport[:idx], maybe_port
        else:
            host, port = hostport, ""
    else:
        host, port = hostport, ""

    try:
        ipaddress.ip_address(host)
        rebuilt = f"{host}:{port}" if port else host
    except ValueError:
        if not host.isascii():
            parts = [p.encode("idna").decode("ascii") if p and not p.isascii() else p for p in host.split(".")]
            host = ".".join(parts)
        rebuilt = f"{host}:{port}" if port else host

    return f"{userinfo}@{rebuilt}" if userinfo else rebuilt
