<template>
  <Teleport to="body">
    <div v-if="visible" class="omv-overlay" @click.self="close">
      <!-- 顶部工具栏 -->
      <div class="omv-toolbar">
        <span class="omv-title">深圳地铁官方线路图</span>
        <button class="omv-btn" @click="close" title="关闭">✕</button>
      </div>

      <!-- 图片区域 -->
      <div
        class="omv-stage"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @wheel.prevent="onWheel"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
      >
        <!-- 加载占位 -->
        <div v-if="loading" class="omv-loading">
          <div class="omv-spinner"></div>
          <span>图片加载中…</span>
        </div>

        <img
          ref="imgRef"
          :src="url"
          class="omv-img"
          :class="{ loaded: imgLoaded }"
          alt="深圳地铁官方线路图"
          draggable="false"
          :style="imgStyle"
          @load="onImgLoad"
          @error="onImgError"
        />
      </div>

      <!-- 长按保存提示 -->
      <div class="omv-save-tip">💡 长按图片可保存高清原图</div>

      <!-- 底部缩放控制 -->
      <div class="omv-controls">
        <button class="omv-btn" @click="zoomOut">−</button>
        <span class="omv-zoom-label">{{ Math.round(scale * 100) }}%</span>
        <button class="omv-btn" @click="zoomIn">＋</button>
        <button class="omv-btn" @click="reset">重置</button>
      </div>

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
import { ref, computed, watch } from 'vue'

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
const loading = ref(false)
const imgLoaded = ref(false)

// 打开时重置加载状态
watch(() => props.visible, (v) => {
  if (v) {
    loading.value = true
    imgLoaded.value = false
    error.value = false
  }
})

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
  loading.value = false
  imgLoaded.value = true
  reset()
}
function onImgError() {
  loading.value = false
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
// 注意：不能无条件 @touchmove.prevent，否则会干扰 iOS 长按图片手势。
// 只在真正拖拽/缩放时才阻止默认滚动。
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
    // 单指拖拽：阻止默认滚动
    e.preventDefault()
    const dx = t[0].clientX - lastX
    const dy = t[0].clientY - lastY
    lastX = t[0].clientX
    lastY = t[0].clientY
    tx.value += dx
    ty.value += dy
  } else if (t.length === 2) {
    // 双指缩放：阻止默认
    e.preventDefault()
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

function openInNewTab() {
  window.open(props.url, '_blank')
}
</script>

<style scoped>
.omv-overlay {
  position: fixed;
  inset: 0;
  /* 半透明浅色 + 毛玻璃，避免纯黑压屏；页面背景会透出一点点 */
  background: rgba(20, 22, 28, 0.5);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 3000;
  display: flex;
  flex-direction: column;
  /* 不能 touch-action:none，否则 iOS 长按图片手势会被禁用 */
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
  background: rgba(0, 0, 0, 0.4);
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
  /* 允许 iOS 长按图片弹出系统菜单 */
  -webkit-user-select: auto;
  user-select: auto;
}
.omv-stage:active {
  cursor: grabbing;
}

.omv-img {
  max-width: 95vw;
  max-height: 90vh;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.08s ease-out, opacity 0.3s ease-out;
  /* 允许 iOS 长按弹出「存储图像」：
     - 不能 pointer-events:none
     - 必须覆盖 body 的全局 user-select:none（否则 iOS 长按图片无系统菜单）
     - -webkit-touch-callout: default 是 iOS 长按图片弹菜单的关键 */
  -webkit-user-drag: none;
  -webkit-user-select: auto !important;
  user-select: auto !important;
  -webkit-touch-callout: default;
  opacity: 0;
}
.omv-img.loaded {
  opacity: 1;
}

.omv-save-tip {
  flex-shrink: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12.5px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.1);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.omv-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  font-size: 13px;
}
.omv-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: omv-spin 0.8s linear infinite;
}
@keyframes omv-spin {
  to { transform: rotate(360deg); }
}

.omv-controls {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.4);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.omv-zoom-label {
  color: #fff;
  font-size: 13px;
  min-width: 48px;
  text-align: center;
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