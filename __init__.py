"""
Alber_comfyui_video_preview
==========================

ComfyUI 自定义节点：一个可以随意缩放、按窗口自适应画面、支持本地视频预览的
视频 / 帧序列预览器。节点显示名 "Alber-video preview"，节点 ID "AlberVideoPreview"。

作者: Alber
"""

import os
import sys

_CUR_DIR = os.path.dirname(os.path.abspath(__file__))
if _CUR_DIR not in sys.path:
    sys.path.insert(0, _CUR_DIR)

try:  # 优先相对导入（ComfyUI 以包方式加载时）
    from .alber_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
    from .alber_routes import register_routes
except Exception:
    from alber_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
    from alber_routes import register_routes

try:
    register_routes()
except Exception as exc:  # 路由注册失败不应阻塞节点加载
    print(f"[Alber_comfyui_video_preview] 路由注册失败: {exc}")

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

print("[Alber_comfyui_video_preview] 已加载 ✓")
