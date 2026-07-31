<template>
  <div class="map-wrap" ref="wrapRef">
    <svg
      class="map"
      ref="svgRef"
      :viewBox="`0 0 ${proj.width} ${proj.height}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <g :transform="`translate(${tx} ${ty}) scale(${scale})`">
        <!-- 线路 -->
        <polyline
          v-for="line in linePolys"
          :key="'l-' + line.id"
          :points="line.points"
          :stroke="line.color"
          stroke-width="5"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          :opacity="dimmed ? 0.25 : 1"
          style="transition: opacity 0.2s"
        />
        <!-- 高亮路径段 -->
        <polyline
          v-for="(seg, i) in highlightPolys"
          :key="'h-' + i"
          :points="seg.points"
          :stroke="seg.color"
          stroke-width="7"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          opacity="0.95"
        />
        <!-- 站点 -->
        <g v-for="s in stations" :key="'s-' + s.id">
          <circle
            :cx="s.x"
            :cy="s.y"
            :r="s.highlight ? 6.5 : 3.5"
            :fill="s.fill"
            :stroke="s.stroke"
            :stroke-width="s.highlight ? 2.5 : 1.5"
            @click.stop="$emit('select-station', s.id)"
            style="cursor: pointer"
          />
          <text
            v-if="showLabel(s)"
            :x="s.x + 6"
            :y="s.y + 4"
            :font-size="11"
            :fill="s.highlight ? '#fff' : 'var(--text)'"
            :font-weight="s.highlight ? 700 : 400"
            style="pointer-events: none; paint-order: stroke; stroke: rgba(0,0,0,0.6); stroke-width: 2.5px"
          >{{ s.name }}</text>
        </g>
      </g>
    </svg>

    <div class="legend" v-if="cityData">
      <div class="lg-item" v-for="line in cityData.lines" :key="'lg-' + line.id">
        <span class="lg-swatch" :style="{ background: line.color }"></span>
        <span>{{ line.name }}</span>
      </div>
    </div>

    <div class="zoom-ctrl">
      <button @click="zoomBy(1.25)">+</button>
      <button @click="zoomBy(0.8)">−</button>
    </div>

    <div class="loading" v-if="loading">加载中…</div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { computeBounds, makeProjection } from '../lib/projection.js'

const props = defineProps({
  cityData: { type: Object, default: null },
  highlight: { type: Array, default: () => [] }, // legs: [{lineId, stops:[id...]}]
  startId: { type: String, default: '' },
  endId: { type: String, default: '' },
  loading: { type: Boolean, default: false }
})

defineEmits(['select-station'])

const svgRef = ref(null)
const wrapRef = ref(null)

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

const proj = computed(() => {
  if (!props.cityData) return { width: 1000, height: 800, project: () => ({ x: 0, y: 0 }) }
  const bounds = computeBounds(props.cityData)
  return makeProjection(bounds, 1000)
})

const dimmed = computed(() => props.highlight && props.highlight.length > 0)

const stationCoords = computed(() => {
  const map = {}
  if (!props.cityData) return map
  const p = proj.value
  for (const [id, st] of Object.entries(props.cityData.stations || {})) {
    if (st.lng == null || st.lat == null) continue
    const { x, y } = p.project(st.lng, st.lat)
    map[id] = { x, y }
  }
  return map
})

const linePolys = computed(() => {
  if (!props.cityData) return []
  const c = stationCoords.value
  return (props.cityData.lines || []).map(line => {
    const pts = (line.stationIds || [])
      .map(id => c[id])
      .filter(Boolean)
      .map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ')
    return { id: line.id, color: line.color, points: pts }
  }).filter(l => l.points)
})

// 高亮路径中包含的站点集合（用于强调）
const highlightStationSet = computed(() => {
  const set = new Set()
  for (const leg of props.highlight || []) {
    for (const sid of leg.stops || []) set.add(sid)
  }
  return set
})

const highlightPolys = computed(() => {
  if (!props.highlight || !props.highlight.length) return []
  const c = stationCoords.value
  const lines = props.cityData.lines || []
  const lineMap = new Map(lines.map(l => [l.id, l]))
  const segs = []
  for (const leg of props.highlight) {
    const line = lineMap.get(leg.lineId)
    if (!line) continue
    const pts = (leg.stops || []).map(id => c[id]).filter(Boolean)
    if (pts.length < 2) continue
    segs.push({
      points: pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),
      color: line.color
    })
  }
  return segs
})

const stations = computed(() => {
  if (!props.cityData) return []
  const c = stationCoords.value
  return Object.entries(props.cityData.stations || {})
    .map(([id, st]) => {
      const co = c[id]
      if (!co) return null
      const isStart = id === props.startId
      const isEnd = id === props.endId
      const onRoute = highlightStationSet.value.has(id)
      const highlight = isStart || isEnd || onRoute
      let fill = '#fff'
      let stroke = '#1a1d24'
      if (isStart) { fill = '#22c55e'; stroke = '#fff' }
      else if (isEnd) { fill = '#ef4444'; stroke = '#fff' }
      else if (onRoute) { fill = '#fff'; stroke = '#4a9eff' }
      return { id, name: st.name, x: co.x, y: co.y, fill, stroke, highlight }
    })
    .filter(Boolean)
})

function showLabel(s) {
  // 缩放足够大 或 是起终点/换乘/路径站点 时显示标签
  if (s.highlight) return true
  return scale.value > 1.6
}

// --- 平移与缩放 ---
const pointers = new Map()
let lastPan = null
let pinchStart = null

function svgPointFromClient(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  const vbW = proj.value.width
  const vbH = proj.value.height
  // viewBox 默认 xMidYMid meet：求实际绘制区域
  const scaleMeet = Math.min(rect.width / vbW, rect.height / vbH)
  const drawnW = vbW * scaleMeet
  const drawnH = vbH * scaleMeet
  const offX = (rect.width - drawnW) / 2
  const offY = (rect.height - drawnH) / 2
  const x = (clientX - rect.left - offX) / scaleMeet
  const y = (clientY - rect.top - offY) / scaleMeet
  return { x, y }
}

function onWheel(e) {
  const factor = e.deltaY < 0 ? 1.12 : 0.89
  zoomAtClient(e.clientX, e.clientY, factor)
}

function onPointerDown(e) {
  svgRef.value?.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) {
    lastPan = { x: e.clientX, y: e.clientY }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchStart = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      scale: scale.value,
      tx: tx.value,
      ty: ty.value
    }
    lastPan = null
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const factor = dist / pinchStart.dist
    const newScale = clamp(pinchStart.scale * factor, 0.5, 12)
    zoomAtClientTo(pinchStart.mid.x, pinchStart.mid.y, newScale, pinchStart)
    return
  }
  if (pointers.size === 1 && lastPan) {
    const dx = e.clientX - lastPan.x
    const dy = e.clientY - lastPan.y
    const rect = svgRef.value.getBoundingClientRect()
    const vbW = proj.value.width
    const scaleMeet = Math.min(rect.width / vbW, rect.height / proj.value.height)
    tx.value += dx / scaleMeet
    ty.value += dy / scaleMeet
    lastPan = { x: e.clientX, y: e.clientY }
  }
}

function onPointerUp(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 1) {
    const [p] = [...pointers.values()]
    lastPan = { x: p.x, y: p.y }
  } else if (pointers.size === 0) {
    lastPan = null
  }
}

function zoomAtClient(cx, cy, factor) {
  const newScale = clamp(scale.value * factor, 0.5, 12)
  zoomAtClientTo(cx, cy, newScale, { scale: scale.value, tx: tx.value, ty: ty.value })
}

function zoomAtClientTo(cx, cy, newScale, base) {
  const before = svgPointFromClient(cx, cy)
  // 反算 before 在 base 变换下的世界坐标
  const wx = (before.x - base.tx) / base.scale
  const wy = (before.y - base.ty) / base.scale
  scale.value = newScale
  tx.value = before.x - wx * newScale
  ty.value = before.y - wy * newScale
}

function zoomBy(factor) {
  const rect = svgRef.value.getBoundingClientRect()
  zoomAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

function resetView() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

watch(() => props.cityData, () => {
  resetView()
})

defineExpose({ resetView, zoomToStations })

function zoomToStations(stationIds) {
  const c = stationCoords.value
  const pts = stationIds.map(id => c[id]).filter(Boolean)
  if (!pts.length) return
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  const w = Math.max(maxX - minX, 1)
  const h = Math.max(maxY - minY, 1)
  const padding = 60
  nextTick(() => {
    const rect = svgRef.value.getBoundingClientRect()
    const scaleMeet = Math.min(rect.width / proj.value.width, rect.height / proj.value.height)
    const targetScale = clamp(
      Math.min((rect.width - padding * 2) / w, (rect.height - padding * 2) / h) / scaleMeet,
      0.5, 8
    )
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    scale.value = targetScale
    tx.value = (rect.width / 2 / scaleMeet - cx * targetScale)
    ty.value = (rect.height / 2 / scaleMeet - cy * targetScale)
  })
}

onMounted(() => { resetView() })
</script>
