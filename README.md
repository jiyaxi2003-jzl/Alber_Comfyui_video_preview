# Alber_comfyui_video_preview

一个塞在节点里的视频预览器：**窗口随便拖大拖小，画面永远等比适配**；左面接各种视频/图像接口，也能直接挑本地视频看。

- 插件包名 / 仓库名：`Alber_comfyui_video_preview`
- 节点显示名：**Alber-video preview**（搜索 `Alber` 即可）
- 节点 ID：`AlberVideoPreview`（保持不变，旧工作流不会失效）

---

## 安装

把整个文件夹丢进 ComfyUI 的 `custom_nodes` 目录，文件夹名保持 `Alber_comfyui_video_preview`：

```
ComfyUI/custom_nodes/Alber_comfyui_video_preview/
├── __init__.py
├── alber_nodes.py
├── alber_routes.py
├── js/
│   └── alber_video_preview.js
└── README.md
```

重启 ComfyUI，在节点搜索里输入 `Alber`，选 **Alber-video preview**（分类在 `Alber/Video`）。

> 无第三方依赖：只需要 ComfyUI 自带的 `torch / numpy / pillow / aiohttp`。
> 如果环境里有 `av`（PyAV，ComfyUI 新版默认带），VIDEO 输入会被解码成帧透传出去；没有也能正常预览。

---

## 输入 / 输出

左侧接口全部是**可选**的，随便接一个就行：

| 接口 | 类型 | 说明 |
|---|---|---|
| `images` | `IMAGE` | 单张图 / 图像批次 / GIF 拆出来的帧 |
| `video` | `VIDEO` | ComfyUI 原生视频类型（Load Video、SaveVideo 一类节点输出） |
| `anything` | `*` | 通配接口：本地路径字符串、`{filename, subfolder, type}` 字典、VIDEO 对象、张量都吃 |

输出：

| 输出 | 类型 | 说明 |
|---|---|---|
| `frames` | `IMAGE` | 把输入原样透传出去，方便继续接别的节点（没有可解码内容时是空张量） |

参数：

| 参数 | 说明 |
|---|---|
| `fps` | IMAGE 批次播放帧率（输入没有帧率信息时用这个） |
| `max_side` | 预览帧最长边像素，越小越流畅（默认 960） |
| `max_frames` | 最多抽多少帧做预览，超出等间隔抽样（默认 240） |
| `autoplay` | 跑完自动播放 |
| `loop` | 循环播放 |

---

## 支持的格式

- **视频**：mp4 / m4v / mov / webm / mkv / avi / flv / wmv / mpg / mpeg / ts / ogv …
  （能不能放取决于浏览器解码器：H.264 的 MP4、VP9/AV1 的 WebM 最稳；HEVC、ProRes 这类浏览器不支持，会提示你转码）
- **动图**：GIF / APNG / Animated WebP（浏览器自身循环）
- **静态图**：png / jpg / webp / bmp
- **帧序列**：`IMAGE` 批次 → 写成临时 JPEG 序列，前端 canvas 播放，可逐帧、可拖进度

---

## 用法

1. 接好上游节点 → 点 **Run**（或 `Ctrl+Enter`），预览器就会播放结果。
2. **拖节点右下角**缩放窗口，画面自动等比铺满，不会变形。
3. **选本地视频**：点工具栏的 📂（文件夹图标）挑文件，或者把视频文件**直接拖进预览窗口**。本地预览走浏览器 `blob:` 地址，不经过服务器、不占显存。
4. 工具栏按钮从左到右：播放/暂停 · 上一帧 · 下一帧 · 循环 · 静音 · 状态文字 · 适应窗口/原始尺寸 · 选本地文件 · 全屏放大（`Esc` 退出）。
5. 点画面任意位置 = 播放/暂停。

---

## 实现说明

- 帧序列存到 `ComfyUI/temp/alber_video_preview/<uid>/`，只保留最近 10 组，自动清理。
- 本地/服务端视频通过 `/alber_video_preview/media?path=...` 流式读取，**支持 HTTP Range**，所以进度条可以随便拖，不会一次把几百 MB 塞进内存。
- 该路由有扩展名白名单（只允许视频/图片后缀），不会变成任意文件读取器。
- 前端对帧做了滑动窗口缓存（当前帧前后 24 帧），长序列也不会把内存吃爆。

## 已知限制

- 浏览器不支持的编码（HEVC / ProRes / 部分 MKV 音轨）无法播放，这是浏览器解码器的限制，转成 H.264 MP4 即可。
- `anything` 通配接口依赖较新的 ComfyUI 前端（支持 `*` 类型）；老版本请直接用 `images` / `video`。

---

作者：Alber · License: MIT · 插件名：Alber_comfyui_video_preview
