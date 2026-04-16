"""
飞书互动卡片 Markdown：图片必须是 ![alt](image_key)，外链 URL 会报错 11310。
若配置 FEISHU_APP_ID + FEISHU_APP_SECRET（与 backend/.env.example 一致），则下载外链并上传至飞书换取 image_key。
否则退化为去掉所有 ![](...) 行。

上传前将所有图标统一为同一正方形：FEISHU_CARD_ICON_PX×FEISHU_CARD_ICON_PX（默认 16）。
  - 「一样大」：每张上传图强制同边长（像素级一致）。
  - 「与字相称」：边长按常见卡片正文字号（约 13～15pt）取近似像素；无法读取飞书客户端真实字号，若仍偏大/偏小请在 .env 改为 14～18 微调。
  - macOS：sips -z W H 强制同宽高；其他：ImageMagick NxN!
  - 设 FEISHU_CARD_ICON_PX=0 关闭缩放（不推荐，图标会过大且不一致）。

依赖：仅标准库；应用需开启机器人能力并具备「上传图片」相关权限 (im:resource)。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

_RESIZE_TOOL_WARNED = False

# 与飞书 Markdown 卡片正文常用字号大致对齐（约 1em）；略小于行高以不显撑行
_DEFAULT_ICON_SIDE_PX = 16


def strip_feishu_card_markdown_images(md: str) -> str:
    """去掉 Markdown 图片语法（飞书不接受外链图）。"""
    return re.sub(r"!\[[^\]]*\]\([^)]*\)\s*", "", md)


def _feishu_tenant_access_token() -> str | None:
    app_id = (os.environ.get("FEISHU_APP_ID") or "").strip()
    app_secret = (os.environ.get("FEISHU_APP_SECRET") or "").strip()
    if not app_id or not app_secret:
        return None
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    body = json.dumps({"app_id": app_id, "app_secret": app_secret}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            data = json.loads(raw)
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None
    if data.get("code") != 0:
        print(
            f"[飞书] 获取 tenant_access_token 失败 code={data.get('code')} msg={data.get('msg')}",
            file=sys.stderr,
        )
        return None
    tok = (data.get("tenant_access_token") or "").strip()
    return tok or None


def _guess_filename(content_type: str | None, url: str) -> str:
    ct = (content_type or "").lower()
    if "png" in ct:
        return "icon.png"
    if "webp" in ct:
        return "icon.webp"
    if "gif" in ct:
        return "icon.gif"
    ul = url.lower()
    if ul.endswith(".png"):
        return "icon.png"
    if ul.endswith(".webp"):
        return "icon.webp"
    if ul.endswith(".gif"):
        return "icon.gif"
    return "icon.jpg"


def _sips_bin() -> str | None:
    p = shutil.which("sips")
    if p:
        return p
    u = "/usr/bin/sips"
    return u if os.path.isfile(u) else None


def _resize_with_sips(image_bytes: bytes, side: int, ext: str) -> bytes | None:
    """macOS：sips -z 高 宽，强制正方形，所有 icon 显示尺寸一致。"""
    sips = _sips_bin()
    if not sips:
        return None
    e = ext.lower() if ext else ".jpg"
    if e not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".ico"):
        e = ".jpg"
    td = tempfile.mkdtemp(prefix="feishu_icon_")
    try:
        inp = os.path.join(td, f"in{e}")
        outp = os.path.join(td, "out.png")
        with open(inp, "wb") as f:
            f.write(image_bytes)
        # man sips: -z pixelsH pixelsW
        r = subprocess.run(
            [sips, "-z", str(side), str(side), inp, "--out", outp],
            capture_output=True,
            timeout=45,
            check=False,
        )
        if r.returncode != 0 or not os.path.isfile(outp):
            return None
        with open(outp, "rb") as f:
            return f.read()
    except (OSError, subprocess.TimeoutExpired):
        return None
    finally:
        shutil.rmtree(td, ignore_errors=True)


def _resize_with_imagemagick(image_bytes: bytes, side: int, ext: str) -> bytes | None:
    """ImageMagick：WxH! 强制正方形，与 sips 行为一致。"""
    exe = shutil.which("magick") or shutil.which("convert")
    if not exe:
        return None
    e = ext.lower() if ext else ".jpg"
    if e not in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff"):
        e = ".jpg"
    td = tempfile.mkdtemp(prefix="feishu_icon_")
    try:
        inp = os.path.join(td, f"in{e}")
        outp = os.path.join(td, "out.png")
        with open(inp, "wb") as f:
            f.write(image_bytes)
        geo = f"{side}x{side}!"
        r = subprocess.run(
            [exe, inp, "-resize", geo, outp],
            capture_output=True,
            timeout=45,
            check=False,
        )
        if r.returncode != 0 or not os.path.isfile(outp):
            return None
        with open(outp, "rb") as f:
            return f.read()
    except (OSError, subprocess.TimeoutExpired):
        return None
    finally:
        shutil.rmtree(td, ignore_errors=True)


def _resize_icon_square(image_bytes: bytes, side: int, ext: str) -> bytes | None:
    """将图标缩放为 side×side 正方形像素；失败返回 None（调用方上传原图）。"""
    if side <= 0:
        return None
    if sys.platform == "darwin":
        out = _resize_with_sips(image_bytes, side, ext)
        if out is not None:
            return out
    out = _resize_with_imagemagick(image_bytes, side, ext)
    if out is not None:
        return out
    return None


def _effective_icon_side_px(explicit: int | None) -> int:
    """正方形边长；explicit 非空时优先，否则读 FEISHU_CARD_ICON_PX。"""
    if explicit is not None:
        return explicit
    try:
        return int(os.environ.get("FEISHU_CARD_ICON_PX") or str(_DEFAULT_ICON_SIDE_PX))
    except ValueError:
        return _DEFAULT_ICON_SIDE_PX


def _prepare_icon_for_upload(image_bytes: bytes, filename: str, *, side_px: int | None = None) -> tuple[bytes, str]:
    """按 FEISHU_CARD_ICON_PX（正方形边长；默认与正文字号近似；设 0 关闭缩放）再上传。
    side_px 非空时覆盖环境变量，用于 column_set 等与飞书 img.mode 匹配的分辨率。"""
    global _RESIZE_TOOL_WARNED
    side = _effective_icon_side_px(side_px)
    if side <= 0:
        return image_bytes, filename
    ext = os.path.splitext(filename)[1] or ".jpg"
    resized = _resize_icon_square(image_bytes, side, ext)
    if resized is not None:
        return resized, "icon.png"
    if side > 0 and not _RESIZE_TOOL_WARNED:
        print(
            "[飞书] 未找到 sips（macOS）或 ImageMagick(convert/magick)，icon 未缩小；仍上传原图。",
            file=sys.stderr,
        )
        _RESIZE_TOOL_WARNED = True
    return image_bytes, filename


def _download_image(url: str) -> tuple[bytes, str] | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; FeishuCardBot/1.0)"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = resp.read()
            ct = resp.headers.get("Content-Type")
    except (urllib.error.URLError, OSError):
        return None
    if len(data) == 0 or len(data) > 10 * 1024 * 1024:
        return None
    return data, _guess_filename(ct, url)


def _upload_image_multipart(token: str, image_bytes: bytes, filename: str) -> str | None:
    boundary = "----WebKitFormBoundary" + uuid.uuid4().hex[:16]
    crlf = b"\r\n"
    b = boundary.encode("ascii")
    parts: list[bytes] = []
    parts.append(b"--" + b + crlf)
    parts.append(b'Content-Disposition: form-data; name="image_type"' + crlf + crlf)
    parts.append(b"message" + crlf)
    parts.append(b"--" + b + crlf)
    cd = f'Content-Disposition: form-data; name="image"; filename="{filename}"'
    parts.append(cd.encode("utf-8") + crlf)
    parts.append(b"Content-Type: application/octet-stream" + crlf + crlf)
    parts.append(image_bytes + crlf)
    parts.append(b"--" + b + b"--" + crlf)
    body = b"".join(parts)
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/im/v1/images",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            out = json.loads(raw)
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None
    if out.get("code") != 0:
        print(
            f"[飞书] 上传图片失败 code={out.get('code')} msg={out.get('msg')}",
            file=sys.stderr,
        )
        return None
    data = out.get("data") or {}
    key = (data.get("image_key") or "").strip()
    return key or None


def feishu_icon_http_url_to_image_key(
    url: str | None,
    cache: dict[str, str],
    *,
    upload_side_px: int | None = None,
) -> str | None:
    """将商店 icon 的 https 地址下载、缩放并上传为 image_key；供 column_set 左列使用。
    upload_side_px 建议与飞书 img 的 mode（tiny/small/medium）对应边长一致，否则易被缩放发糊。"""
    u = (url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        return None
    token = _feishu_tenant_access_token()
    if not token:
        return None
    return _url_to_image_key(token, u, cache, upload_side_px=upload_side_px)


def _url_to_image_key(
    token: str,
    url: str,
    cache: dict[str, str],
    *,
    upload_side_px: int | None = None,
) -> str | None:
    side = _effective_icon_side_px(upload_side_px)
    ck = f"{url}\npx={side}"
    if ck in cache:
        return cache[ck]
    got = _download_image(url)
    if not got:
        return None
    image_bytes, filename = got
    image_bytes, filename = _prepare_icon_for_upload(image_bytes, filename, side_px=side)
    key = _upload_image_multipart(token, image_bytes, filename)
    if key:
        cache[ck] = key
    return key


# Markdown 图片：![alt](https?://...) — 与 _markdown_icon_prefix 生成的 URL 一致
_IMG_HTTP = re.compile(r"!\[([^\]]*)\]\((https?://[^)]+)\)")


def prepare_feishu_card_markdown(md: str) -> str:
    """
    将正文中的 ![alt](http...) 转为 ![alt](image_key)；
    未配置 FEISHU_APP_ID/SECRET 或上传失败时去掉外链图。
    """
    if "![" not in md or "http" not in md:
        return md
    app_id = (os.environ.get("FEISHU_APP_ID") or "").strip()
    app_secret = (os.environ.get("FEISHU_APP_SECRET") or "").strip()
    if not app_id or not app_secret:
        return strip_feishu_card_markdown_images(md)
    token = _feishu_tenant_access_token()
    if not token:
        return strip_feishu_card_markdown_images(md)

    cache: dict[str, str] = {}

    def repl(m: re.Match[str]) -> str:
        alt = m.group(1)
        url = m.group(2)
        key = _url_to_image_key(token, url, cache, upload_side_px=None)
        if not key:
            return ""
        return f"![{alt}]({key})"

    out = _IMG_HTTP.sub(repl, md)
    if cache:
        print(f"[飞书] 已为卡片上传 {len(cache)} 个 icon（image_key）", file=sys.stderr)
    return out
