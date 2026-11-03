/**
 * Alber-video preview · 前端
 *
 * 一个塞在节点里的视频播放器：
 *  - 节点可以随意拖拽放大缩小，播放器跟着节点自适应
 *  - 画面永远按窗口等比缩放（object-fit: contain / canvas 等比绘制）
 *  - 支持真实视频（mp4/mov/webm/mkv…）、GIF/WebP 动图、IMAGE 帧序列
 *  - 工具栏文件夹按钮可以直接选本地视频，或把文件拖到预览窗口里
 *  - 右上角 ⛶ 可以把播放器抽出来全屏看
 */

import { app } from "../../scripts/app.js";

const NODE_NAME = "AlberVideoPreview";
const MIN_WIDTH = 260;
const MIN_ROOT_H = 150;
const CACHE_RADIUS = 24;

/* ------------------------------------------------------------------ */
/* 样式                                                                */
/* ------------------------------------------------------------------ */
const CSS = `
.alber-vp{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;box-sizing:border-box;
  background:#0a0c10;border:1px solid #242b36;border-radius:8px;overflow:hidden;color:#c9d3df;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  font-size:11px;-webkit-user-select:none;user-select:none}
.alber-vp *{box-sizing:border-box}
.alber-vp-bar{display:flex;align-items:center;gap:2px;padding:3px 4px;flex:0 0 auto;
  background:linear-gradient(180deg,#181d26,#11151c);border-bottom:1px solid #222935}
.alber-vp-btn{appearance:none;border:1px solid transparent;background:transparent;color:#8e9aab;border-radius:4px;
  width:21px;height:19px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
  font-size:10px;line-height:1;transition:background .12s ease,color .12s ease;font-family:inherit}
.alber-vp-btn:hover{background:#242c39;color:#eaf1fa}
.alber-vp-btn:active{transform:scale(.93)}
.alber-vp-btn.on{background:rgba(56,139,253,.16);color:#7cb8ff;border-color:rgba(64,132,220,.5)}
.alber-vp-label{flex:1 1 auto;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;color:#7f8a9b;font-size:9.5px;letter-spacing:.2px;padding:0 3px}
.alber-vp-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;
  overflow:hidden;background:#07090c;cursor:pointer}
.alber-vp-stage.actual{overflow:auto;align-items:flex-start;justify-content:flex-start;cursor:default}
.alber-media{display:none;width:100%;height:100%;object-fit:contain}
.alber-media.visible{display:block}
.alber-frame{position:absolute;inset:0;display:none}
.alber-frame.visible{display:block}
.alber-vp-stage.actual video.alber-media,.alber-vp-stage.actual img.alber-media{
  width:auto;height:auto;max-width:none;max-height:none;object-fit:none}
.alber-vp-drop{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#4b5564;text-align:center;padding:10px;pointer-events:none;line-height:1.7}
.alber-vp-drop b{display:block;font-size:20px;font-weight:400;margin-bottom:3px;opacity:.65}
.alber-vp-drop small{font-size:10px}
.alber-vp-foot{display:flex;align-items:center;gap:6px;padding:1px 6px 3px;flex:0 0 auto;
  background:#11151c;border-top:1px solid #1b212a}
.alber-vp-range{-webkit-appearance:none;appearance:none;flex:1 1 auto;height:12px;background:transparent;
  cursor:pointer;margin:0;min-width:40px}
.alber-vp-range:disabled{cursor:default;opacity:.4}
.alber-vp-range::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:#2a3340}
.alber-vp-range::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;border-radius:50%;
  background:#5b9cf8;margin-top:-3px;border:none}
.alber-vp-range::-moz-range-track{height:3px;border-radius:2px;background:#2a3340}
.alber-vp-range::-moz-range-thumb{width:9px;height:9px;border:none;border-radius:50%;background:#5b9cf8}
.alber-vp-time{flex:0 0 auto;color:#6d7889;font-size:9.5px;font-variant-numeric:tabular-nums;
  text-align:right;white-space:nowrap}
.alber-vp.dragover{outline:1px dashed #4b8bf5;outline-offset:-3px}
.alber-vp-overlay{position:fixed;inset:0;z-index:100000;background:rgba(4,6,9,.88);
  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;
  padding:28px;animation:alberFade .14s ease}
@keyframes alberFade{from{opacity:0}to{opacity:1}}
.alber-vp-overlay-inner{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.alber-vp-close{position:absolute;top:10px;right:14px;width:30px;height:30px;border-radius:50%;
  border:1px solid #2b3441;background:#151a22;color:#c9d3df;font-size:13px;cursor:pointer;z-index:2}
.alber-vp-close:hover{background:#222b38;color:#fff}
`;

const TEMPLATE = [
  '<div class="alber-vp-bar">',
  '<button class="alber-vp-btn a-play" title="播放 / 暂停">&#9654;</button>',
  '<button class="alber-vp-btn a-prev" title="上一帧">&#9198;</button>',
  '<button class="alber-vp-btn a-next" title="下一帧">&#9197;</button>',
  '<button class="alber-vp-btn a-loop on" title="循环播放">&#128257;</button>',
  '<button class="alber-vp-btn a-mute on" title="静音">&#128263;</button>',
  '<span class="alber-vp-label">Alber-video preview</span>',
  '<button class="alber-vp-btn a-fit" title="适应窗口 / 原始尺寸">&#8663;</button>',
  '<button class="alber-vp-btn a-open" title="选择本地视频 / 动图">&#128193;</button>',
  '<button class="alber-vp-btn a-full" title="放大预览">&#9974;</button>',
  '</div>',
  '<div class="alber-vp-stage">',
  '<video class="alber-media alber-video" playsinline preload="auto" muted></video>',
  '<canvas class="alber-frame"></canvas>',
  '<img class="alber-media alber-img" alt="" />',
  '<div class="alber-vp-drop"><div><b>&#127916;</b><small>无输入 · 点 &#128193; 选本地视频，或把视频拖进来</small></div></div>',
  '</div>',
  '<div class="alber-vp-foot">',
  '<input class="alber-vp-range" type="range" min="0" max="0" value="0" step="1" />',
  '<span class="alber-vp-time">0.00s / 0.00s</span>',
  '</div>',
].join("");

function ensureStyle() {
  if (document.getElementById("alber-vp-css")) return;
  const style = document.createElement("style");
  style.id = "alber-vp-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function fmtTime(sec) {
  const s = Number(sec);
  if (!isFinite(s) || s < 0) return "0.00s";
  if (s < 60) return s.toFixed(2) + "s";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
}

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */
function setup(node) {
  if (node.__alber) return;
  ensureStyle();

  const root = document.createElement("div");
  root.className = "alber-vp";
  root.innerHTML = TEMPLATE;

  const q = (sel) => root.querySelector(sel);
  const els = {
    root,
    stage: q(".alber-vp-stage"),
    video: q("video.alber-media"),
    img: q("img.alber-media"),
    canvas: q("canvas.alber-frame"),
    drop: q(".alber-vp-drop"),
    dropSmall: q(".alber-vp-drop small"),
    label: q(".alber-vp-label"),
    time: q(".alber-vp-time"),
    range: q(".alber-vp-range"),
    play: q(".a-play"),
    prev: q(".a-prev"),
    next: q(".a-next"),
    loop: q(".a-loop"),
    mute: q(".a-mute"),
    fit: q(".a-fit"),
    open: q(".a-open"),
    full: q(".a-full"),
  };

  const S = {
    els,
    widget: null,
    mode: "empty",
    frames: [],
    fps: 12,
    loop: true,
    playing: false,
    index: 0,
    acc: 0,
    lastT: 0,
    raf: 0,
    fit: "contain",
    imgCache: new Map(),
    lastDrawn: null,
    objectUrl: null,
    label: "",
    naturalW: 0,
    naturalH: 0,
    duration: 0,
    count: 0,
    dragging: false,
    overlay: null,
    overlayKey: null,
    ro: null,
    ctx: els.canvas.getContext("2d"),
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
  node.__alber = S;

  if (typeof node.addDOMWidget === "function") {
    S.widget = node.addDOMWidget("alber_preview", "preview", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => MIN_ROOT_H,
      getValue: () => "",
      setValue: () => {},
    });
  } else {
    console.warn("[Alber-video preview] 当前前端版本不支持 addDOMWidget，预览不可用");
    return;
  }

  /* ---------------- 事件 ---------------- */
  const stop = (e) => e.stopPropagation();

  els.play.addEventListener("click", (e) => { stop(e); setPlaying(node, !S.playing); });
  els.stage.addEventListener("click", () => {
    if (S.mode === "empty") return;
    setPlaying(node, !S.playing);
  });
  els.prev.addEventListener("click", (e) => { stop(e); stepBy(node, -1); });
  els.next.addEventListener("click", (e) => { stop(e); stepBy(node, 1); });
  els.loop.addEventListener("click", (e) => {
    stop(e);
    S.loop = !S.loop;
    els.video.loop = S.loop;
    updateUI(node);
  });
  els.mute.addEventListener("click", (e) => {
    stop(e);
    const m = !els.video.muted;
    els.video.muted = m;
    if (!m) { try { els.video.volume = 0.85; } catch (_) {} }
    updateUI(node);
  });
  els.fit.addEventListener("click", (e) => {
    stop(e);
    setFit(node, S.fit === "contain" ? "actual" : "contain");
  });
  els.open.addEventListener("click", (e) => { stop(e); pickLocalFile(node); });
  els.full.addEventListener("click", (e) => { stop(e); toggleFullscreen(node); });

  els.range.addEventListener("pointerdown", () => { S.dragging = true; });
  window.addEventListener("pointerup", () => { S.dragging = false; });
  els.range.addEventListener("input", () => seekTo(node, Number(els.range.value)));

  /* ---------------- media 事件 ---------------- */
  els.video.addEventListener("loadedmetadata", () => {
    if (els.video.videoWidth) S.naturalW = els.video.videoWidth;
    if (els.video.videoHeight) S.naturalH = els.video.videoHeight;
    if (isFinite(els.video.duration) && els.video.duration > 0) S.duration = els.video.duration;
    updateUI(node);
    resizeCanvas(node);
  });
  els.video.addEventListener("timeupdate", () => updateUI(node));
  els.video.addEventListener("play", () => { S.playing = true; updateUI(node); });
  els.video.addEventListener("pause", () => { S.playing = false; updateUI(node); });
  els.video.addEventListener("ended", () => {
    if (S.loop) { try { els.video.currentTime = 0; els.video.play().catch(() => {}); } catch (_) {} }
    else { S.playing = false; updateUI(node); }
  });
  els.video.addEventListener("error", () => {
    if (S.mode !== "video") return;
    els.drop.style.display = "flex";
    els.dropSmall.textContent = "这个视频浏览器放不了（编码不支持，试试转成 H.264 MP4）";
  });

  els.img.addEventListener("load", () => {
    if (els.img.naturalWidth) S.naturalW = els.img.naturalWidth;
    if (els.img.naturalHeight) S.naturalH = els.img.naturalHeight;
    updateUI(node);
  });

  /* ---------------- 拖拽本地文件 ---------------- */
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    root.classList.add("dragover");
  });
  root.addEventListener("dragleave", () => root.classList.remove("dragover"));
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    root.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadLocalFile(node, file);
  });

  /* ---------------- 尺寸跟随 ---------------- */
  if (typeof ResizeObserver !== "undefined") {
    S.ro = new ResizeObserver(() => resizeCanvas(node));
    S.ro.observe(els.stage);
  }

  updateUI(node);
  requestAnimationFrame(() => layout(node));
}

/* ------------------------------------------------------------------ */
/* 尺寸布局                                                            */
/* ------------------------------------------------------------------ */
function estimateTop(node, widget) {
  const LG = window.LiteGraph || {};
  const titleH = LG.NODE_TITLE_HEIGHT || 30;
  const slotH = LG.NODE_SLOT_HEIGHT || 20;
  const rows = Math.max(
    node.inputs ? node.inputs.length : 0,
    node.outputs ? node.outputs.length : 0
  );
  let y = titleH + rows * slotH + 4;
  const widgets = node.widgets || [];
  const width = node.size ? node.size[0] : 300;
  for (const w of widgets) {
    if (w === widget) break;
    if (w.type === "hidden") continue;
    let h = 24;
    try {
      const cs = w.computeSize ? w.computeSize(width) : null;
      if (cs && cs[1] > 0) h = cs[1];
    } catch (_) {}
    y += h;
  }
  return y;
}

function layout(node) {
  const S = node.__alber;
  if (!S || !S.widget) return;
  const widget = S.widget;
  const nodeH = node.size ? node.size[1] : 400;
  const nodeW = node.size ? node.size[0] : 400;

  let top = widget.last_y;
  if (!top || top <= 0) top = estimateTop(node, widget);

  const avail = Math.max(MIN_ROOT_H, nodeH - top - 6);
  S.avail = avail;
  widget.computeSize = () => [Math.max(MIN_WIDTH, nodeW), avail];
  S.els.root.style.height = avail + "px";
  if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
  requestAnimationFrame(() => resizeCanvas(node));
}

function minNodeHeight(node) {
  const S = node.__alber;
  const top = S && S.widget && S.widget.last_y > 0
    ? S.widget.last_y
    : estimateTop(node, S ? S.widget : null);
  return Math.round(top + MIN_ROOT_H + 8);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */
function imageFor(S, i) {
  if (i < 0 || i >= S.frames.length) return null;
  let im = S.imgCache.get(i);
  if (!im) {
    im = new Image();
    im.decoding = "async";
    im.src = S.frames[i];
    S.imgCache.set(i, im);
  }
  return im;
}

function prefetch(S) {
  const start = Math.max(0, S.index), end = Math.min(S.frames.length - 1, S.index + 8);
  for (let i = start; i <= end; i++) imageFor(S, i);
}

function pruneCache(S) {
  for (const k of Array.from(S.imgCache.keys())) {
    if (Math.abs(k - S.index) > CACHE_RADIUS) S.imgCache.delete(k);
  }
}

function resizeCanvas(node) {
  const S = node.__alber;
  if (!S || S.mode !== "frames") return;
  const cvs = S.els.canvas;
  const stage = S.els.stage;

  if (S.fit === "actual" && S.naturalW > 0 && S.naturalH > 0) {
    cvs.style.position = "relative";
    cvs.style.inset = "auto";
    cvs.style.width = S.naturalW + "px";
    cvs.style.height = S.naturalH + "px";
    cvs.width = Math.round(S.naturalW * S.dpr);
    cvs.height = Math.round(S.naturalH * S.dpr);
  } else {
    cvs.style.position = "absolute";
    cvs.style.inset = "0";
    cvs.style.width = "100%";
    cvs.style.height = "100%";
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    cvs.width = Math.round(w * S.dpr);
    cvs.height = Math.round(h * S.dpr);
  }
  drawFrame(node);
}

function drawFrame(node) {
  const S = node.__alber;
  if (!S || S.mode !== "frames") return;
  const cvs = S.els.canvas;
  const ctx = S.ctx;
  if (!ctx || cvs.width < 1 || cvs.height < 1) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cvs.width, cvs.height);

  const im = imageFor(S, S.index);
  if (!im) return;

  const iw = im.naturalWidth || 0;
  const ih = im.naturalHeight || 0;
  if (!iw || !ih) {
    if (!im.__alberHook) {
      im.__alberHook = true;
      im.addEventListener("load", () => {
        if (S.mode === "frames") { drawFrame(node); updateUI(node); }
      });
    }
    // 当前帧还没解码好：先用上一张顶着，避免闪黑
    const prev = S.lastDrawn;
    if (prev && prev.naturalWidth) {
      drawToCanvas(S, prev);
    }
    return;
  }

  S.lastDrawn = im;
  drawToCanvas(S, im);
}

function drawToCanvas(S, im) {
  const cvs = S.els.canvas;
  const ctx = S.ctx;
  const iw = im.naturalWidth || 0;
  const ih = im.naturalHeight || 0;
  if (!ctx || !iw || !ih) return;
  const scale = Math.min(cvs.width / iw, cvs.height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.imageSmoothingEnabled = true;
  try { ctx.imageSmoothingQuality = "high"; } catch (_) {}
  ctx.drawImage(im, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
}

/* ------------------------------------------------------------------ */
/* 播放控制                                                            */
/* ------------------------------------------------------------------ */
function tick(node, ts) {
  const S = node.__alber;
  if (!S) return;
  if (S.mode !== "frames" || !S.playing) { S.raf = 0; return; }

  if (!S.lastT) S.lastT = ts;
  let dt = (ts - S.lastT) / 1000;
  S.lastT = ts;
  if (dt > 0.5) dt = 0.5;
  if (dt < 0) dt = 0;
  S.acc += dt;

  const spf = 1 / Math.max(0.1, S.fps);
  let changed = false;
  let guard = 0;
  while (S.acc >= spf && guard++ < 12) {
    S.acc -= spf;
    if (S.index + 1 >= S.frames.length) {
      if (S.loop) S.index = 0;
      else { S.playing = false; break; }
    } else {
      S.index++;
    }
    changed = true;
  }

  if (changed) {
    pruneCache(S);
    prefetch(S);
    drawFrame(node);
    updateUI(node);
  }

  if (S.playing) S.raf = requestAnimationFrame((t) => tick(node, t));
  else { S.raf = 0; updateUI(node); }
}

function setPlaying(node, want) {
  const S = node.__alber;
  if (!S) return;
  if (S.mode === "video") {
    if (want) {
      const p = S.els.video.play();
      if (p && p.catch) p.catch(() => {});
      S.playing = true;
    } else {
      S.els.video.pause();
      S.playing = false;
    }
  } else if (S.mode === "frames") {
    S.playing = !!want;
    S.lastT = 0;
    S.acc = 0;
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    if (S.playing) S.raf = requestAnimationFrame((t) => tick(node, t));
  } else {
    S.playing = false;
  }
  updateUI(node);
}

function stepBy(node, dir) {
  const S = node.__alber;
  if (S.mode === "frames" && S.frames.length) {
    setPlaying(node, false);
    S.index = Math.max(0, Math.min(S.frames.length - 1, S.index + dir));
    pruneCache(S);
    prefetch(S);
    drawFrame(node);
    updateUI(node);
  } else if (S.mode === "video") {
    setPlaying(node, false);
    const dt = 1 / Math.max(1, S.fps || 12);
    const dur = S.duration || 0;
    const t = (S.els.video.currentTime || 0) + dir * dt;
    S.els.video.currentTime = Math.max(0, Math.min(dur > 0 ? dur : 1e9, t));
    updateUI(node);
  }
}

function seekTo(node, value) {
  const S = node.__alber;
  if (S.mode === "frames" && S.frames.length) {
    S.index = Math.max(0, Math.min(S.frames.length - 1, Math.round(value)));
    pruneCache(S);
    prefetch(S);
    drawFrame(node);
    updateUI(node);
  } else if (S.mode === "video" && S.duration > 0) {
    S.els.video.currentTime = (value / 1000) * S.duration;
    updateUI(node);
  }
}

function setFit(node, fit) {
  const S = node.__alber;
  S.fit = fit;
  S.els.stage.classList.toggle("actual", fit === "actual");
  resizeCanvas(node);
  updateUI(node);
}

/* ------------------------------------------------------------------ */
/* 状态刷新                                                            */
/* ------------------------------------------------------------------ */
function updateUI(node) {
  const S = node.__alber;
  if (!S) return;
  const els = S.els;

  els.play.innerHTML = S.playing ? "&#10074;&#10074;" : "&#9654;";
  els.play.classList.toggle("on", S.playing);
  els.loop.classList.toggle("on", S.loop);
  els.mute.classList.toggle("on", els.video.muted);
  els.fit.classList.toggle("on", S.fit === "actual");
  els.full.classList.toggle("on", !!S.overlay);

  let cur = 0;
  let total = 0;

  if (S.mode === "frames" && S.frames.length) {
    const fps = Math.max(0.1, S.fps);
    cur = S.index / fps;
    total = S.duration > 0 ? S.duration : S.frames.length / fps;
    els.range.disabled = false;
    els.range.max = String(Math.max(0, S.frames.length - 1));
    if (!S.dragging) els.range.value = String(S.index);
  } else if (S.mode === "video") {
    cur = els.video.currentTime || 0;
    total = S.duration || (isFinite(els.video.duration) ? els.video.duration : 0) || 0;
    els.range.disabled = !(total > 0);
    els.range.max = "1000";
    if (!S.dragging) els.range.value = String(total > 0 ? Math.round((cur / total) * 1000) : 0);
  } else {
    els.range.disabled = true;
    els.range.max = "0";
    if (!S.dragging) els.range.value = "0";
  }

  const bits = [];
  if (S.mode === "frames") bits.push("帧 " + (S.index + 1) + "/" + S.frames.length);
  bits.push(fmtTime(cur) + " / " + fmtTime(total));
  els.time.textContent = bits.join("  ");

  if (S.label) els.label.textContent = S.label;
  else if (S.mode === "empty") els.label.textContent = "Alber-video preview";
}

/* ------------------------------------------------------------------ */
/* 模式切换 / 数据接入                                                 */
/* ------------------------------------------------------------------ */
function setMode(node, mode) {
  const S = node.__alber;
  S.mode = mode;

  const visible = { video: S.els.video, frames: S.els.canvas, image: S.els.img };
  Object.keys(visible).forEach((k) => {
    visible[k].classList.toggle("visible", k === mode);
  });
  S.els.drop.style.display = mode === "empty" ? "flex" : "none";

  if (mode !== "frames") {
    cancelAnimationFrame(S.raf);
    S.raf = 0;
  }
  if (mode !== "video") {
    try { S.els.video.pause(); } catch (_) {}
  }
  if (mode === "frames") {
    requestAnimationFrame(() => resizeCanvas(node));
  }
}

function applyPayload(node, data) {
  const S = node.__alber;
  if (!S || !data) return;

  S.fps = Number(data.fps) > 0 ? Number(data.fps) : 12;
  S.loop = data.loop !== false;
  S.label = data.label || "";
  S.naturalW = Number(data.width) || 0;
  S.naturalH = Number(data.height) || 0;
  S.duration = Number(data.duration) || 0;
  S.count = Number(data.count) || 0;
  S.els.video.loop = S.loop;

  const mode = data.mode || "empty";

  if (mode === "frames" && Array.isArray(data.frames) && data.frames.length) {
    S.frames = data.frames.slice();
    S.index = 0;
    S.acc = 0;
    S.lastDrawn = null;
    S.imgCache.clear();
    setMode(node, "frames");
    prefetch(S);
    drawFrame(node);
    setPlaying(node, data.autoplay !== false);
  } else if (mode === "video" && data.src) {
    S.frames = [];
    S.imgCache.clear();
    setMode(node, "video");
    S.els.video.src = data.src;
    S.els.video.loop = S.loop;
    S.els.video.load();
    if (data.autoplay !== false) setPlaying(node, true);
    else S.playing = false;
  } else if (mode === "image" && data.src) {
    S.frames = [];
    S.imgCache.clear();
    setMode(node, "image");
    S.els.img.src = data.src;
    S.playing = false;
  } else {
    S.frames = [];
    S.index = 0;
    S.playing = false;
    setMode(node, "empty");
    S.els.dropSmall.textContent = data.message || "无输入";
  }

  updateUI(node);
  if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
}

/* ------------------------------------------------------------------ */
/* 本地文件                                                            */
/* ------------------------------------------------------------------ */
function pickLocalFile(node) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.flv,.wmv,.gif,.webp,.apng,.png,.jpg,.jpeg";
  input.style.display = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) loadLocalFile(node, file);
    setTimeout(() => input.remove(), 0);
  });
  input.click();
}

function loadLocalFile(node, file) {
  const S = node.__alber;
  if (!S) return;
  if (S.objectUrl) {
    try { URL.revokeObjectURL(S.objectUrl); } catch (_) {}
    S.objectUrl = null;
  }
  const url = URL.createObjectURL(file);
  S.objectUrl = url;

  const name = file.name || "local";
  const isImage = /^image\//i.test(file.type || "") ||
    /\.(gif|webp|apng|png|jpe?g|bmp|avif)$/i.test(name);

  S.frames = [];
  S.imgCache.clear();
  S.lastDrawn = null;
  S.index = 0;
  S.acc = 0;
  S.naturalW = 0;
  S.naturalH = 0;
  S.duration = 0;
  S.fps = 12;
  S.label = name;

  if (isImage) {
    setMode(node, "image");
    S.els.img.src = url;
    S.playing = false;
  } else {
    setMode(node, "video");
    S.els.video.src = url;
    S.els.video.loop = S.loop;
    S.els.video.load();
    setPlaying(node, true);
  }
  updateUI(node);
  if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
}

/* ------------------------------------------------------------------ */
/* 全屏浮层                                                            */
/* ------------------------------------------------------------------ */
function toggleFullscreen(node) {
  const S = node.__alber;
  if (!S) return;
  if (S.overlay) { closeOverlay(node); return; }

  const ov = document.createElement("div");
  ov.className = "alber-vp-overlay";
  const inner = document.createElement("div");
  inner.className = "alber-vp-overlay-inner";
  const close = document.createElement("button");
  close.className = "alber-vp-close";
  close.innerHTML = "&#10005;";
  close.title = "关闭 (Esc)";

  inner.appendChild(S.els.stage);
  ov.appendChild(inner);
  ov.appendChild(close);
  document.body.appendChild(ov);

  S.overlay = ov;
  S.overlayKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeOverlay(node); }
  };
  window.addEventListener("keydown", S.overlayKey, true);

  close.addEventListener("click", (e) => { e.stopPropagation(); closeOverlay(node); });
  ov.addEventListener("click", (e) => { if (e.target === ov) closeOverlay(node); });

  updateUI(node);
  requestAnimationFrame(() => resizeCanvas(node));
}

function closeOverlay(node) {
  const S = node.__alber;
  if (!S || !S.overlay) return;
  const ov = S.overlay;
  const foot = S.els.root.querySelector(".alber-vp-foot");
  if (foot) S.els.root.insertBefore(S.els.stage, foot);
  else S.els.root.appendChild(S.els.stage);
  ov.remove();

  S.overlay = null;
  if (S.overlayKey) {
    window.removeEventListener("keydown", S.overlayKey, true);
    S.overlayKey = null;
  }
  layout(node);
  requestAnimationFrame(() => { resizeCanvas(node); updateUI(node); });
}

/* ------------------------------------------------------------------ */
/* 注册                                                                */
/* ------------------------------------------------------------------ */
app.registerExtension({
  name: "Alber.VideoPreview",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

      const self = this;
      setup(self);

      const width = Math.max(MIN_WIDTH, 420);
      self.setSize([width, 560]);
      self.computeSize = function () {
        return [Math.max(MIN_WIDTH, self.size ? self.size[0] : width), 200];
      };
      requestAnimationFrame(() => layout(self));
      return r;
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize ? onResize.apply(this, arguments) : undefined;
      if (size) {
        if (size[0] < MIN_WIDTH) { size[0] = MIN_WIDTH; this.size[0] = MIN_WIDTH; }
        const minH = minNodeHeight(this);
        if (size[1] < minH) { size[1] = minH; this.size[1] = minH; }
      }
      layout(this);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      requestAnimationFrame(() => layout(this));
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      if (onExecuted) onExecuted.apply(this, arguments);
      try {
        const data = message && message.alber_preview && message.alber_preview[0];
        if (data) applyPayload(this, data);
      } catch (err) {
        console.error("[Alber-video preview]", err);
      }
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const S = this.__alber;
      if (S) {
        if (S.overlay) closeOverlay(this);
        cancelAnimationFrame(S.raf);
        if (S.ro) { try { S.ro.disconnect(); } catch (_) {} }
        if (S.objectUrl) { try { URL.revokeObjectURL(S.objectUrl); } catch (_) {} }
        S.imgCache.clear();
        this.__alber = null;
      }
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  },
});
