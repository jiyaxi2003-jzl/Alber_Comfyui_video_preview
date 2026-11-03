"""
Alber-video preview · 后端节点

把 ComfyUI 里各种「视频/图像」输入统一整理成前端可以直接播放的数据：

    IMAGE / IMAGE 批次   -> 逐帧 JPEG 序列（前端 canvas 播放，可拖进度、可循环）
    VIDEO 对象           -> 落成可流式播放的本地文件（带 HTTP Range，可拖动进度）
    str 路径 / URL       -> 直接作为视频或动图引用
    dict {filename,subfolder,type} -> 走 ComfyUI 的 /view 接口
    GIF / webp / png     -> 原生 <img> 播放（动图由浏览器自身循环）

同时把输入原样透传出去（frames 输出），不影响后面的节点链路。
"""

from __future__ import annotations

import math
import os
import shutil
import time
import uuid
from urllib.parse import quote

import numpy as np
import torch
from PIL import Image

try:
    import folder_paths
except Exception:  # 允许在没有 ComfyUI 的环境里 import（仅用于语法检查）
    folder_paths = None

try:
    import av

    _HAS_AV = True
except Exception:
    av = None
    _HAS_AV = False


PREVIEW_DIRNAME = "alber_video_preview"

# 允许通过 /alber_video_preview/media 流式读取的扩展名（白名单，防止读取任意文件）
VIDEO_EXTS = {
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv", ".wmv",
    ".mpg", ".mpeg", ".ts", ".m2ts", ".mts", ".ogv", ".3gp",
}
ANIM_EXTS = {".gif", ".apng", ".webp"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
ALL_EXTS = VIDEO_EXTS | ANIM_EXTS | IMAGE_EXTS

MAX_SIDE_LIMIT = 4096


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def _temp_root() -> str:
    if folder_paths is None:
        return os.path.join(os.path.expanduser("~"), ".alber_video_preview")
    return os.path.join(folder_paths.get_temp_directory(), PREVIEW_DIRNAME)


def _preview_dir(uid: str) -> str:
    d = os.path.join(_temp_root(), str(uid))
    os.makedirs(d, exist_ok=True)
    return d


def _view_url(filename: str, subfolder: str, folder_type: str = "temp") -> str:
    return (
        f"/view?filename={quote(filename)}"
        f"&subfolder={quote(subfolder)}"
        f"&type={quote(folder_type)}"
    )


def _media_url(path: str) -> str:
    return f"/alber_video_preview/media?path={quote(os.path.abspath(path))}"


def _cleanup_old(keep: int = 10) -> None:
    """只保留最近若干个预览目录，避免 temp 目录无限膨胀。"""
    root = _temp_root()
    try:
        dirs = [os.path.join(root, d) for d in os.listdir(root)]
        dirs = [d for d in dirs if os.path.isdir(d)]
        dirs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        for p in dirs[keep:]:
            shutil.rmtree(p, ignore_errors=True)
    except Exception:
        pass


def _ext(path: str) -> str:
    return os.path.splitext(path)[1].lower()


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)}B" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}GB"


# --------------------------------------------------------------------------- #
# 帧序列保存
# --------------------------------------------------------------------------- #
def save_image_batch(images: torch.Tensor, uid: str, max_side: int, max_frames: int):
    """把 IMAGE 批次存成缩略帧序列，返回 (urls, frame_count, step, w, h)。"""
    total = int(images.shape[0])
    h = int(images.shape[1])
    w = int(images.shape[2])
    if total <= 0:
        return [], 0, 1, w, h

    step = max(1, math.ceil(total / max_frames))
    indices = list(range(0, total, step))[:max_frames]

    scale = min(1.0, float(max_side) / float(max(w, h, 1)))
    tw = max(1, int(round(w * scale)))
    th = max(1, int(round(h * scale)))

    out_dir = _preview_dir(uid)
    subfolder = f"{PREVIEW_DIRNAME}/{uid}"

    urls = []
    for n, i in enumerate(indices):
        arr = images[i]
        if isinstance(arr, torch.Tensor):
            arr = arr.detach().float().cpu().numpy()
        arr = np.asarray(arr)
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=-1)
        if arr.shape[-1] == 4:
            arr = arr[..., :3]
        arr = (np.clip(arr, 0.0, 1.0) * 255.0).astype(np.uint8)

        img = Image.fromarray(arr, "RGB")
        if (tw, th) != (w, h):
            img = img.resize((tw, th), Image.LANCZOS)

        name = f"f{n:05d}.jpg"
        img.save(os.path.join(out_dir, name), format="JPEG", quality=86, subsampling=0)
        urls.append(_view_url(name, subfolder))

    return urls, len(indices), step, tw, th


# --------------------------------------------------------------------------- #
# 视频探测 / 解码
# --------------------------------------------------------------------------- #
def probe_video(path: str) -> dict:
    info = {"width": 0, "height": 0, "fps": 0.0, "duration": 0.0, "frames": 0}
    if not _HAS_AV or not os.path.isfile(path):
        return info
    try:
        with av.open(path) as container:
            vs = container.streams.video[0] if container.streams.video else None
            if vs is not None:
                info["width"] = int(vs.codec_context.width or 0)
                info["height"] = int(vs.codec_context.height or 0)
                if vs.average_rate:
                    info["fps"] = round(float(vs.average_rate), 3)
                elif vs.guessed_rate:
                    info["fps"] = round(float(vs.guessed_rate), 3)
                if vs.frames:
                    info["frames"] = int(vs.frames)
            if container.duration:
                info["duration"] = round(container.duration / 1e6, 3)
            elif vs is not None and vs.duration and vs.time_base:
                info["duration"] = round(float(vs.duration * vs.time_base), 3)
    except Exception:
        pass
    return info


def decode_video_frames(path: str, max_frames: int, max_side: int) -> torch.Tensor:
    """用 PyAV 解码若干帧（等间隔抽样），失败则返回空张量。"""
    empty = torch.zeros((0, 1, 1, 3), dtype=torch.float32)
    if not _HAS_AV or not os.path.isfile(path):
        return empty
    try:
        with av.open(path) as container:
            if not container.streams.video:
                return empty
            stream = container.streams.video[0]
            total = int(stream.frames or 0)
            step = 1
            if total and total > max_frames:
                step = max(1, math.ceil(total / max_frames))

            picked = []
            for idx, frame in enumerate(container.decode(stream)):
                if idx % step:
                    continue
                arr = frame.to_ndarray(format="rgb24")
                picked.append(arr)
                if len(picked) >= max_frames:
                    break

        if not picked:
            return empty

        out = []
        for arr in picked:
            h, w = arr.shape[:2]
            scale = min(1.0, float(max_side) / float(max(w, h, 1)))
            if scale < 1.0:
                img = Image.fromarray(arr, "RGB").resize(
                    (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                    Image.LANCZOS,
                )
                arr = np.asarray(img)
            out.append(arr.astype(np.float32) / 255.0)
        return torch.from_numpy(np.stack(out, axis=0))
    except Exception:
        return empty


# --------------------------------------------------------------------------- #
# VIDEO 对象 -> 本地文件
# --------------------------------------------------------------------------- #
def video_object_to_path(video, uid: str):
    """尽量把一个 VIDEO 对象变成磁盘上的真实视频文件。"""
    # 1) ComfyUI 新版 VIDEO 输入：get_stream_source()
    getter = getattr(video, "get_stream_source", None)
    if callable(getter):
        src = None
        try:
            src = getter()
        except Exception:
            src = None

        if isinstance(src, (str, bytes, os.PathLike)):
            try:
                p = os.path.abspath(os.fsdecode(src))
                if os.path.isfile(p):
                    return p
            except Exception:
                pass

        if hasattr(src, "read"):
            try:
                out_dir = _preview_dir(uid)
                pos = None
                try:
                    pos = src.tell()
                except Exception:
                    pass
                out = os.path.join(out_dir, "preview.bin")
                with open(out, "wb") as f:
                    shutil.copyfileobj(src, f)
                try:
                    if pos is not None:
                        src.seek(pos)
                except Exception:
                    pass
                if os.path.getsize(out) > 0:
                    return out
                os.remove(out)
            except Exception:
                pass

    # 2) VIDEO 输入支持 save_to()
    if hasattr(video, "save_to"):
        out_dir = _preview_dir(uid)
        candidates = [
            ("mp4", "mp4", "h264"),
            ("webm", "webm", "vp9"),
            ("auto", "mp4", None),
            ("auto", "webm", None),
        ]
        for fmt, ext, codec in candidates:
            out = os.path.join(out_dir, f"preview.{ext}")
            kwargs = {"format": fmt}
            if codec:
                kwargs["codec"] = codec
            try:
                video.save_to(out, **kwargs)
                if os.path.isfile(out) and os.path.getsize(out) > 0:
                    return out
            except Exception:
                if os.path.isfile(out):
                    try:
                        os.remove(out)
                    except Exception:
                        pass
            try:  # 有些版本 save_to 只接受位置参数
                video.save_to(out)
                if os.path.isfile(out) and os.path.getsize(out) > 0:
                    return out
            except Exception:
                pass
    return None


def _video_label(path: str, meta: dict) -> str:
    ext = _ext(path).lstrip(".").upper() or "VIDEO"
    size = ""
    try:
        size = _human_size(os.path.getsize(path))
    except Exception:
        pass
    bits = [ext]
    if meta.get("width"):
        bits.append(f'{meta["width"]}x{meta["height"]}')
    if meta.get("fps"):
        bits.append(f'{meta["fps"]:g}fps')
    if meta.get("duration"):
        bits.append(f'{meta["duration"]:.2f}s')
    if size:
        bits.append(size)
    return " · ".join(bits)


# --------------------------------------------------------------------------- #
# 节点
# --------------------------------------------------------------------------- #
class AlberVideoPreview:
    CATEGORY = "Alber/Video"
    FUNCTION = "run"
    OUTPUT_NODE = True
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("frames",)
    DESCRIPTION = (
        "可缩放视频预览器。左侧接入 IMAGE / IMAGE批次 / VIDEO / GIF / 路径 / 任意类型，"
        "也会把结果原样透传出去。窗口大小随意拖拽，画面自动等比适配；"
        "工具栏的文件夹按钮可以直接选本地视频预览。"
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "fps": ("FLOAT", {
                    "default": 12.0, "min": 0.1, "max": 240.0, "step": 0.5,
                    "tooltip": "IMAGE 批次播放帧率（无帧率信息时使用）",
                }),
                "max_side": ("INT", {
                    "default": 960, "min": 128, "max": 4096, "step": 32,
                    "tooltip": "预览帧生成的最长边像素（越小越流畅）",
                }),
                "max_frames": ("INT", {
                    "default": 240, "min": 1, "max": 2000, "step": 1,
                    "tooltip": "最多抽多少帧做预览，超出会等间隔抽样",
                }),
                "autoplay": ("BOOLEAN", {"default": True, "label_on": "自动播放", "label_off": "不自动播放"}),
                "loop": ("BOOLEAN", {"default": True, "label_on": "循环", "label_off": "单次"}),
            },
            "optional": {
                "images": ("IMAGE", {"forceInput": True, "tooltip": "图像 / 图像批次 / GIF 拆帧"}),
                "video": ("VIDEO", {"forceInput": True, "tooltip": "ComfyUI 原生 VIDEO 类型"}),
                "anything": ("*", {"forceInput": True, "tooltip": "任意类型：路径字符串、{filename,subfolder,type}、VIDEO 对象等"}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    # ------------------------------------------------------------------ #
    def run(self, fps, max_side, max_frames, autoplay, loop,
            images=None, video=None, anything=None, unique_id=None):
        fps = float(fps) if fps else 12.0
        max_side = int(max(64, min(int(max_side), MAX_SIDE_LIMIT)))
        max_frames = int(max(1, min(int(max_frames), 2000)))
        uid = f"{int(time.time() * 1000):x}{uuid.uuid4().hex[:6]}"

        payload = {
            "mode": "empty",
            "src": "",
            "frames": [],
            "fps": fps,
            "loop": bool(loop),
            "autoplay": bool(autoplay),
            "width": 0,
            "height": 0,
            "count": 0,
            "duration": 0.0,
            "label": "",
            "kind": "",
            "message": "无输入 · 点工具栏的文件夹图标选本地视频，或直接把视频拖到窗口里",
        }
        out_frames = None

        try:
            if images is not None:
                out_frames = images
                payload.update(self._payload_from_images(images, uid, fps, max_side, max_frames))

            elif video is not None:
                res = self._payload_from_video_obj(video, uid, fps, max_frames, max_side)
                payload.update(res["payload"])
                out_frames = res["frames"]

            elif anything is not None:
                res = self._payload_from_anything(anything, uid, fps, max_side, max_frames)
                payload.update(res["payload"])
                out_frames = res["frames"]

        except Exception as exc:  # 任何异常都只在预览器里提示，不炸整个队列
            payload.update(mode="empty", message=f"预览失败: {exc}")

        if out_frames is None:
            out_frames = torch.zeros((0, 1, 1, 3), dtype=torch.float32)

        try:
            _cleanup_old(keep=10)
        except Exception:
            pass

        return {"ui": {"alber_preview": [payload]}, "result": (out_frames,)}

    # ------------------------------------------------------------------ #
    @staticmethod
    def _payload_from_images(images, uid, fps, max_side, max_frames) -> dict:
        total = int(images.shape[0])
        urls, count, step, w, h = save_image_batch(images, uid, max_side, max_frames)
        if not urls:
            return {"mode": "empty", "message": "空批次"}
        play_fps = max(0.1, fps / max(1, step))
        duration = total / fps if fps > 0 else count / play_fps
        return {
            "mode": "frames",
            "frames": urls,
            "fps": round(play_fps, 3),
            "count": total,
            "width": w,
            "height": h,
            "duration": round(duration, 3),
            "kind": "IMAGE",
            "label": f"IMAGE ×{total} · {w}x{h} · {play_fps:g}fps"
                     + (f" · 抽样 1/{step}" if step > 1 else ""),
        }

    @classmethod
    def _payload_from_video_obj(cls, video, uid, fps, max_frames, max_side) -> dict:
        path = video_object_to_path(video, uid)
        if not path:
            return {"payload": {"mode": "empty", "message": "无法解析该 VIDEO 对象（缺少可读的流或内核不支持）"},
                    "frames": None}
        meta = probe_video(path)
        frames = decode_video_frames(path, max_frames, max_side) if _HAS_AV else None
        return {
            "payload": {
                "mode": "video",
                "src": _media_url(path),
                "fps": meta.get("fps") or fps,
                "width": meta.get("width", 0),
                "height": meta.get("height", 0),
                "count": meta.get("frames", 0),
                "duration": meta.get("duration", 0.0),
                "kind": _ext(path).lstrip(".").upper(),
                "label": _video_label(path, meta),
            },
            "frames": frames,
        }

    @classmethod
    def _payload_from_anything(cls, value, uid, fps, max_side, max_frames) -> dict:
        # torch 张量 -> 当作帧
        if isinstance(value, torch.Tensor) and value.ndim == 4:
            return {"payload": cls._payload_from_images(value, uid, fps, max_side, max_frames),
                    "frames": value}

        # 列表：取第一个可用元素
        if isinstance(value, (list, tuple)) and value:
            for item in value:
                res = cls._payload_from_anything(item, uid, fps, max_side, max_frames)
                if res["payload"].get("mode") != "empty":
                    return res
            return {"payload": {"mode": "empty", "message": "列表里没有可预览的内容"}, "frames": None}

        # 字典：ComfyUI 的 {filename, subfolder, type} 结构
        if isinstance(value, dict):
            filename = value.get("filename") or value.get("file") or value.get("path")
            folder_type = value.get("type") or "temp"
            subfolder = value.get("subfolder") or ""
            if isinstance(filename, str) and filename:
                ext = _ext(filename)
                mode = "video" if (ext in VIDEO_EXTS or ext not in (ANIM_EXTS | IMAGE_EXTS)) else "image"
                url = _view_url(filename, subfolder, folder_type)
                return {"payload": {
                    "mode": mode, "src": url,
                    "fps": fps, "kind": (ext.lstrip(".").upper() or "FILE"),
                    "label": filename + (f"  ({ext.lstrip('.').upper()})" if ext else ""),
                }, "frames": None}

        # 字符串：本地路径 或 http 链接
        if isinstance(value, (str, bytes, os.PathLike)):
            text = os.fsdecode(value) if isinstance(value, bytes) else str(value)
            text = text.strip()
            if text.startswith(("http://", "https://")):
                return {"payload": {"mode": "video", "src": text, "fps": fps, "kind": "URL", "label": text},
                        "frames": None}
            p = os.path.abspath(os.path.expanduser(text))
            if os.path.isfile(p):
                ext = _ext(p)
                if ext in VIDEO_EXTS:
                    meta = probe_video(p)
                    return {"payload": {
                        "mode": "video", "src": _media_url(p),
                        "fps": meta.get("fps") or fps,
                        "width": meta.get("width", 0), "height": meta.get("height", 0),
                        "count": meta.get("frames", 0), "duration": meta.get("duration", 0.0),
                        "kind": ext.lstrip(".").upper(), "label": _video_label(p, meta),
                    }, "frames": decode_video_frames(p, max_frames, max_side)}
                if ext in ANIM_EXTS or ext in IMAGE_EXTS:
                    return {"payload": {"mode": "image", "src": _media_url(p), "fps": fps,
                                        "kind": ext.lstrip(".").upper(), "label": os.path.basename(p)},
                            "frames": None}
            return {"payload": {"mode": "empty", "message": f"找不到可预览的文件: {text[:80]}"}, "frames": None}

        # 其它 VIDEO 对象
        if hasattr(value, "get_stream_source") or hasattr(value, "save_to"):
            return {"payload": cls._payload_from_video_obj(value, uid, fps, max_frames, max_side)["payload"],
                    "frames": None}

        return {"payload": {"mode": "empty", "message": f"暂不支持的类型: {type(value).__name__}"}, "frames": None}


NODE_CLASS_MAPPINGS = {"AlberVideoPreview": AlberVideoPreview}
NODE_DISPLAY_NAME_MAPPINGS = {"AlberVideoPreview": "Alber-video preview"}
