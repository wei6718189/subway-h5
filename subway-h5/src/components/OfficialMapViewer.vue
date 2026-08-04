<template>
  <Teleport to="body">
    <div v-if="visible" class="omv-overlay" @click.self="close">
      <!-- 顶部工具栏 -->
      <div class="omv-toolbar">
        <span class="omv-title">深圳地铁官方线路图</span>
        <button class="omv-btn" @click="download" title="下载到本地">⬇ 下载</button>
        <button class="omv-btn" @click="close" title="关闭">✕</button>
      </div>

      <!-- 图片区域 -->
      <div
        class="omv-stage"
        @touchstart="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <img
          ref="imgRef"
          :src="url"
          class="omv-img"
          alt="深圳地铁官方线路图"
          draggable="false"
          :style="imgStyle"
          @load="onImgLoad"
          @error="onImgError"
        />
      </div>

      <!-- 底部缩放控制 -->
      <div class="omv-controls">
        <button class="omv-btn" @click="zoomOut">−</button>
        <span class="omv-zoom-label">{{ Math.round(scale * 100) }}%</span>
        <button class="omv-btn" @click="zoomIn">＋</button>
        <button class="omv-btn" @click="reset">重置</button>
      </div>

      <!-- 操作提示 -->
      <div v-if="hint" class="omv-hint">{{ hint }}</div>

      <!-- 加载失败提示 -->
      <div v-if="error" class="omv-error">
        <p>图片加载失败</p>
        <p class="omv-error-sub">请检查网络后重试，或点击下方按钮在新窗口打开</p>
        <button class="omv-btn primary" @click="openInNewTab">在新窗口打开</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  url: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const imgRef = ref(null)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const error = ref(false)
const downloading = ref(false)
const hint = ref('')
let hintTimer = null

function showHint(msg) {
  hint.value = msg
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hint.value = '' }, 3200)
}

// 拖拽状态
let dragging = false
let lastX = 0
let lastY = 0
// 双指缩放状态
let pinchDist = 0
let pinchScale = 1
let pinchTx = 0
let pinchTy = 0

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`
}))

function onImgLoad() {
  error.value = false
  reset()
}
function onImgError() {
  error.value = true
}

function close() {
  emit('close')
  // 关闭后重置状态，下次打开重新加载
  setTimeout(reset, 200)
}

// ---- 缩放 ----
function zoomIn() {
  setScale(scale.value * 1.25)
}
function zoomOut() {
  setScale(scale.value / 1.25)
}
function reset() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}
function setScale(s) {
  scale.value = Math.min(8, Math.max(0.5, s))
}

// 滚轮缩放（桌面）
function onWheel(e) {
  const factor = e.deltaY < 0 ? 1.1 : 0.9
  setScale(scale.value * factor)
}

// ---- 鼠标拖拽（桌面） ----
function onMouseDown(e) {
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}
function onMouseMove(e) {
  if (!dragging) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  tx.value += dx
  ty.value += dy
}
function onMouseUp() {
  dragging = false
}

// ---- 触摸拖拽 + 双指缩放（移动端） ----
function onTouchStart(e) {
  const t = e.touches
  if (t.length === 1) {
    dragging = true
    lastX = t[0].clientX
    lastY = t[0].clientY
  } else if (t.length === 2) {
    dragging = false
    pinchDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    pinchScale = scale.value
    pinchTx = tx.value
    pinchTy = ty.value
  }
}
function onTouchMove(e) {
  const t = e.touches
  if (t.length === 1 && dragging) {
    const dx = t[0].clientX - lastX
    const dy = t[0].clientY - lastY
    lastX = t[0].clientX
    lastY = t[0].clientY
    tx.value += dx
    ty.value += dy
  } else if (t.length === 2) {
    const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const ratio = dist / pinchDist
    // 围绕双指中点缩放
    const centerX = (t[0].clientX + t[1].clientX) / 2
    const centerY = (t[0].clientY + t[1].clientY) / 2
    const newScale = Math.min(8, Math.max(0.5, pinchScale * ratio))
    const scaleRatio = newScale / pinchScale
    tx.value = centerX - (centerX - pinchTx) * scaleRatio
    ty.value = centerY - (centerY - pinchTy) * scaleRatio
    scale.value = newScale
  }
}
function onTouchEnd() {
  dragging = false
  pinchDist = 0
}

// ---- 下载 ----
function fileName() {
  return '深圳地铁官方线路图.jpg'
}

async function download() {
  if (downloading.value) return
  downloading.value = true
  try {
    // 主方案：fetch + blob + a.download（需要服务器允许 CORS）
    const res = await fetch(props.url, { mode: 'cors' })
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName()
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
    showHint('已开始下载')
  } catch (e) {
    // 跨域资源无 CORS 头，无法 fetch 下载：
    // - iOS：Safari 会静默拦截异步 window.open，改为提示长按图片保存
    // - Android：可打开新页面，长按保存
    console.warn('跨域下载受限（服务器未返回 CORS 头）:', e)
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    if (isIOS) {
      showHint('浏览器限制无法直接下载，请长按图片保存到相册')
    } else {
      showHint('请在新页面中长按图片保存')
      openInNewTab()
    }
  } finally {
    downloading.value = false
  }
}

function openInNewTab() {
  window.open(props.url, '_blank')
}
</script>

<style scoped>
.omv-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  z-index: 3000;
  display: flex;
  flex-direction: column;
  touch-action: none;
  /* 不能全局 user-select:none，否则 iOS 长按图片不会弹出「存储图像」菜单 */
}
.omv-toolbar,
.omv-controls {
  user-select: none;
  -webkit-user-select: none;
}

.omv-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(var(--safe-top, 0px) + 10px) 12px 10px;
  background: rgba(0, 0, 0, 0.6);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.omv-title {
  flex: 1;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.omv-btn {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.omv-btn:active {
  background: rgba(255, 255, 255, 0.35);
}
.omv-btn.primary {
  background: #4a9eff;
  border-color: #4a9eff;
}

.omv-stage {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}
.omv-stage:active {
  cursor: grabbing;
}

.omv-img {
  max-width: 95vw;
  max-height: 90vh;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.08s ease-out;
  /* 允许 iOS 长按弹出「存储图像」，因此不能 pointer-events:none */
  -webkit-user-drag: none;
}

.omv-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.6);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.omv-zoom-label {
  color: #fff;
  font-size: 13px;
  min-width: 48px;
  text-align: center;
}

.omv-hint {
  position: fixed;
  bottom: 84px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.88);
  color: #fff;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  z-index: 20;
  white-space: nowrap;
  max-width: 88vw;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.omv-error {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  padding: 24px 32px;
  text-align: center;
  color: #fff;
  z-index: 10;
}
.omv-error p {
  margin: 0 0 12px;
  font-size: 15px;
}
.omv-error .omv-error-sub {
  font-size: 12px;
  color: #aaa;
}
</style>