"""
Alber-video preview · HTTP 路由

给前端一个能流式读取本地视频的接口（支持 HTTP Range，所以进度条可以随便拖）。
只允许白名单内的视频 / 图片扩展名，避免变成任意文件读取器。
"""

from __future__ import annotations

import mimetypes
import os
import re

from aiohttp import web

try:
    from server import PromptServer
except Exception:  # 非 ComfyUI 环境
    PromptServer = None

try:
    from .alber_nodes import ALL_EXTS
except Exception:
    try:
        from alber_nodes import ALL_EXTS
    except Exception:
        ALL_EXTS = {
            ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv", ".wmv",
            ".mpg", ".mpeg", ".ts", ".m2ts", ".mts", ".ogv", ".gif", ".webp",
            ".png", ".jpg", ".jpeg", ".bmp",
        }

CHUNK = 1024 * 512
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _resolve(path_str: str):
    if not path_str:
        return None
    try:
        p = os.path.abspath(os.path.expanduser(path_str))
    except Exception:
        return None
    if not os.path.isfile(p):
        return None
    if os.path.splitext(p)[1].lower() not in ALL_EXTS:
        return None
    return p


async def _serve(request: web.Request) -> web.StreamResponse:
    path = _resolve(request.query.get("path", ""))
    if path is None:
        raise web.HTTPNotFound(text="file not found or extension not allowed")

    size = os.path.getsize(path)
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    range_header = request.headers.get("Range") or request.headers.get("range")

    if range_header:
        m = _RANGE_RE.match(range_header.strip())
        if m:
            start_s, end_s = m.group(1), m.group(2)
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                raise web.HTTPRequestRangeNotSatisfiable(
                    headers={"Content-Range": f"bytes */{size}"}
                )

            resp = web.StreamResponse(
                status=206,
                reason="Partial Content",
                headers={
                    "Content-Type": ctype,
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes {start}-{end}/{size}",
                    "Cache-Control": "no-store",
                },
            )
            resp.content_length = end - start + 1
            await resp.prepare(request)
            with open(path, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    await resp.write(chunk)
                    remaining -= len(chunk)
            await resp.write_eof()
            return resp

    resp = web.StreamResponse(
        headers={
            "Content-Type": ctype,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        }
    )
    resp.content_length = size
    await resp.prepare(request)
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            await resp.write(chunk)
    await resp.write_eof()
    return resp


async def _ping(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "name": "Alber-video preview"})


def register_routes() -> None:
    if PromptServer is None or getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes
    routes.get("/alber_video_preview/media")(_serve)
    routes.get("/alber_video_preview/ping")(_ping)
