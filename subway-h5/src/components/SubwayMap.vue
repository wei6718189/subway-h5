<template>
  <div class="map-wrap">
    <svg
      class="map"
      ref="svgRef"
      :viewBox="`0 0 ${proj.width} ${proj.height}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel.prevent="onWheel"
      @click="onSvgClick"
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
          <!-- 换乘站：单层圆圈（白底+描边，类似示例 SVG）+ 内部双箭头 -->
          <template v-if="s.isTransfer">
            <circle
              :cx="s.x"
              :cy="s.y"
              :r="s.highlight ? 7.5 : 6"
              :fill="s.highlight ? s.fill : '#fff'"
              :stroke="s.highlight ? s.stroke : '#1a1d24'"
              :stroke-width="s.highlight ? 2.5 : 1.8"
              @click.stop="$emit('select-station', s.id)"
              style="cursor: pointer"
            />
            <path
              :d="transferIconPath(s.x, s.y, s.highlight ? 5.5 : 4.2)"
              fill="none"
              :stroke="s.highlight ? '#fff' : '#1a1d24'"
              stroke-width="1.1"
              stroke-linecap="round"
              stroke-linejoin="round"
              pointer-events="none"
            />
          </template>
          <!-- 普通站 / 起终点：单层圆圈 -->
          <circle
            v-else
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
            v-if="labelData.get(s.id)?.visible"
            :x="s.x + (labelData.get(s.id)?.dx ?? (s.isTransfer ? 10 : 6))"
            :y="s.y + (labelData.get(s.id)?.dy ?? 4)"
            :text-anchor="labelData.get(s.id)?.anchor ?? 'start'"
            :font-size="s.isTransfer ? 12 : 11"
            :font-weight="s.isTransfer ? 600 : 400"
            :fill="s.highlight ? '#fff' : 'var(--text)'"
            style="pointer-events: none; paint-order: stroke; stroke: rgba(0,0,0,0.75); stroke-width: 2.5px"
          >{{ s.name }}</text>
        </g>
      </g>
    </svg>

    <div class="legend" v-if="cityData">
      <div class="legend-toggle" @click="toggleLegend">
        <span>线路图例</span>
        <span class="legend-arrow">{{ legendOpen ? '▼' : '▶' }}</span>
      </div>
      <div class="legend-body" v-if="legendOpen">
        <div class="lg-item" v-for="line in cityData.lines" :key="'lg-' + line.id">
          <span class="lg-swatch" :style="{ background: line.color }"></span>
          <span>{{ line.name }}</span>
        </div>
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

const emit = defineEmits(['select-station'])

const svgRef = ref(null)

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

const proj = computed(() => {
  if (!props.cityData) return { width: 1000, height: 800, projectStation: () => ({ x: 0, y: 0 }), projectXY: () => ({ x: 0, y: 0 }) }
  const bounds = computeBounds(props.cityData)
  return makeProjection(bounds, 1000)
})

const dimmed = computed(() => props.highlight && props.highlight.length > 0)

const stationCoords = computed(() => {
  const map = {}
  if (!props.cityData) return map
  const p = proj.value
  for (const [id, st] of Object.entries(props.cityData.stations || {})) {
    // 支持示意图坐标（x/y）和经纬度（lng/lat）
    if (st.x != null && st.y != null) {
      const { x, y } = p.projectXY(st.x, st.y)
      map[id] = { x, y }
    } else if (st.lng != null && st.lat != null) {
      const { x, y } = p.projectStation(st)
      map[id] = { x, y }
    }
  }
  return map
})

const linePolys = computed(() => {
  if (!props.cityData) return []
  const p = proj.value
  return (props.cityData.lines || []).map(line => {
    let pts = ''
    // 优先使用高德提供的路径 polyline 点（更平滑准确）
    if (line.path && line.path.length > 0) {
      pts = line.path
        .map(([x, y]) => {
          const pt = p.projectXY(x, y)
          return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`
        })
        .join(' ')
    } else {
      // 回退：用站点坐标连线
      const c = stationCoords.value
      pts = (line.stationIds || [])
        .map(id => c[id])
        .filter(Boolean)
        .map(pt => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
        .join(' ')
    }
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

const legendOpen = ref(false)

// 切换图例折叠/展开
function toggleLegend() {
  legendOpen.value = !legendOpen.value
}

const stations = computed(() => {
  if (!props.cityData) return []
  const c = stationCoords.value
  // 按站名去重：同名站（换乘站跨线）只渲染一次，坐标取第一个有效坐标
  const byName = new Map()
  for (const [id, st] of Object.entries(props.cityData.stations || {})) {
    const co = c[id]
    if (!co) continue
    if (!byName.has(st.name)) {
      byName.set(st.name, { id, st, co, dupIds: [] })
    }
    byName.get(st.name).dupIds.push(id)
  }
  return [...byName.values()].map(({ id, st, co, dupIds }) => {
    const lines = st.lines || []
    const isTransfer = lines.length >= 2
    const isStart = dupIds.includes(props.startId)
    const isEnd = dupIds.includes(props.endId)
    const onRoute = dupIds.some(did => highlightStationSet.value.has(did))
    const highlight = isStart || isEnd || onRoute
    let fill = '#fff'
    let stroke = '#1a1d24'
    if (isStart) { fill = '#22c55e'; stroke = '#fff' }
    else if (isEnd) { fill = '#ef4444'; stroke = '#fff' }
    else if (onRoute) { fill = '#fff'; stroke = '#4a9eff' }
    return {
      id, name: st.name, x: co.x, y: co.y, fill, stroke, highlight,
      isTransfer, lines
    }
  })
})

function showLabel(s) {
  // 所有站点全部显示（依靠 4 方向防重叠来避免遮挡，只有 4 个位置都冲突时才隐藏）
  return true
}

// 标签防重叠 2.0：
// 1) 按优先级排序：高亮站（起终点/路径站） > 换乘站 > 普通站
//    确保关键站点优先拿到标签位置
// 2) 每个站点尝试 4 个位置（右、上、左、下），选第一个不冲突的位置
// 3) 返回 Map<id, {visible, dx, dy, anchor}>
const labelData = computed(() => {
  const list = stations.value
  const result = new Map()
  if (!list.length) return result

  // 排序：优先级高的先分配标签
  const sorted = [...list].sort((a, b) => {
    const pa = a.highlight ? 0 : (a.isTransfer ? 1 : 2)
    const pb = b.highlight ? 0 : (b.isTransfer ? 1 : 2)
    if (pa !== pb) return pa - pb
    // 同优先级按线路数多的排前
    return (b.lines?.length || 0) - (a.lines?.length || 0)
  })

  const sc = scale.value
  const charW = 9
  const charH = 13
  const padX = 2
  const padY = 1

  // 4 个候选偏移（dx, dy, anchor）
  //   相对 SVG 坐标：SVG y 轴向下，文本 baseline 在 y 上
  const candidates = [
    // 右侧：文字右对齐在站点右侧
    { pos: 'right',  dx: 0,  dy: 0,   anchor: 'start',  offsetX: (s) => (s.isTransfer ? 10 : 7), offsetY: () => 4 },
    // 上方：文本水平居中在站点上方
    { pos: 'top',    dx: 0,  dy: 0,   anchor: 'middle', offsetX: () => 0,             offsetY: (s) => -(s.isTransfer ? 9 : 7) },
    // 左侧：文字右对齐在站点左侧
    { pos: 'left',   dx: 0,  dy: 0,   anchor: 'end',    offsetX: (s) => -(s.isTransfer ? 10 : 7), offsetY: () => 4 },
    // 下方：文本水平居中在站点下方
    { pos: 'bottom', dx: 0,  dy: 0,   anchor: 'middle', offsetX: () => 0,             offsetY: () => charH + 5 }
  ]

  const placed = [] // 已放置标签矩形（屏幕坐标）

  for (const s of sorted) {
    if (!showLabel(s)) { result.set(s.id, { visible: false }); continue }

    const nameLen = (s.name || '').length
    const bw = nameLen * charW + padX * 2
    const bh = charH + padY * 2

    let placedOk = false

    // 换乘站和高亮站：强制显示（跳过冲突检查，或只记录占用）
    const forceShow = s.highlight || s.isTransfer

    for (let ci = 0; ci < candidates.length; ci++) {
      const c = candidates[ci]
      const offX = c.offsetX(s)
      const offY = c.offsetY(s)
      // 文本坐标
      const tx_ = s.x + offX
      const ty_ = s.y + offY

      // 文本 bounding box（世界坐标）：根据 anchor 计算起点 x1
      let bx, by
      if (c.anchor === 'start') {
        bx = tx_ - padX
      } else if (c.anchor === 'end') {
        bx = tx_ - bw + padX
      } else {
        bx = tx_ - bw / 2
      }
      // y = baseline，文本实际占据 (y - charH) ~ y 范围内的高度
      by = ty_ - charH - padY

      // 转为屏幕坐标做碰撞检测
      const sx1 = (bx + tx.value) * sc
      const sy1 = (by + ty.value) * sc
      const sx2 = sx1 + bw * sc
      const sy2 = sy1 + bh * sc

      // 检测与已放置矩形是否碰撞
      let collide = false
      for (const r of placed) {
        if (!(sx2 < r.x1 || sx1 > r.x2 || sy2 < r.y1 || sy1 > r.y2)) {
          collide = true
          break
        }
      }

      if (!collide) {
        placed.push({ x1: sx1, y1: sy1, x2: sx2, y2: sy2 })
        result.set(s.id, {
          visible: true,
          dx: offX,
          dy: offY,
          anchor: c.anchor
        })
        placedOk = true
        break
      }
    }

    if (!placedOk) {
      // 四个位置全部冲突：换乘/高亮站仍默认放右侧（强制显示），普通站隐藏
      if (forceShow) {
        const c = candidates[0]
        const offX = c.offsetX(s)
        const offY = c.offsetY(s)
        result.set(s.id, {
          visible: true,
          dx: offX,
          dy: offY,
          anchor: c.anchor
        })
        // 仍记录占用，避免后面的继续堆这里
        const tx_ = s.x + offX
        const bx = tx_ - padX
        const by = (s.y + offY) - charH - padY
        placed.push({
          x1: (bx + tx.value) * sc,
          y1: (by + ty.value) * sc,
          x2: (bx + tx.value) * sc + bw * sc,
          y2: (by + ty.value) * sc + bh * sc
        })
      } else {
        result.set(s.id, { visible: false })
      }
    }
  }

  return result
})

function isLabelVisible(s) {
  return labelData.value.get(s.id)?.visible === true
}

// 换乘站双向箭头图标：在以 (cx,cy) 为中心、r 为内圈半径的圆内绘制
// 严格按示例 SVG 比例（viewBox 200x200, 圆心 100,100, r=94）：
//   水平线 x: 52→148 (半长 48 ≈ 0.51r)
//   箭头头内侧 x: 70/130 (距圆心 30 ≈ 0.32r)
//   箭头头纵向偏移: ±18 ≈ 0.19r
function transferIconPath(cx, cy, r) {
  const half = r * 0.51    // 箭头水平半长
  const headIn = r * 0.32  // 箭头头内侧距圆心
  const headY = r * 0.19   // 箭头头纵向偏移
  return [
    // 水平线
    `M ${cx - half} ${cy} H ${cx + half}`,
    // 右箭头头（指向右）
    `M ${cx + half} ${cy} L ${cx + headIn} ${cy - headY}`,
    `M ${cx + half} ${cy} L ${cx + headIn} ${cy + headY}`,
    // 左箭头头（指向左）
    `M ${cx - half} ${cy} L ${cx - headIn} ${cy - headY}`,
    `M ${cx - half} ${cy} L ${cx - headIn} ${cy + headY}`
  ].join(' ')
}

// --- 平移与缩放 ---
const pointers = new Map()
let lastPan = null
let pinchStart = null

function svgPointFromClient(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  const vbW = proj.value.width || 1000
  const vbH = proj.value.height || 800
  const scaleMeet = Math.min(rect.width / vbW, rect.height / vbH) || 1
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
  didPan.value = false
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) {
    lastPan = { x: e.clientX, y: e.clientY }
    // 记录点击起始位置，用于判断是否为 click
    clickStart.value = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
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
    clickStart.value = null
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
    didPan.value = true
    return
  }
  if (pointers.size === 1 && lastPan) {
    const dx = e.clientX - lastPan.x
    const dy = e.clientY - lastPan.y
    // 标记已拖拽，防止 click 误触发
    if (Math.hypot(dx, dy) > 3) didPan.value = true
    const rect = svgRef.value.getBoundingClientRect()
    const vbW = proj.value.width
    const scaleMeet = Math.min(rect.width / vbW, rect.height / proj.value.height)
    tx.value += dx / scaleMeet
    ty.value += dy / scaleMeet
    lastPan = { x: e.clientX, y: e.clientY }
  }
}

const clickStart = ref(null)
const CLICK_THRESHOLD = 5 // 像素位移阈值

function onPointerUp(e) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 1) {
    const [p] = [...pointers.values()]
    lastPan = { x: p.x, y: p.y }
  } else if (pointers.size === 0) {
    lastPan = null
  }

  // 判断是否为点击（非拖拽）：位移 < 阈值
  if (clickStart.value) {
    const dx = e.clientX - clickStart.value.x
    const dy = e.clientY - clickStart.value.y
    const dist = Math.hypot(dx, dy)
    if (dist < CLICK_THRESHOLD && !pinchStart) {
      // 视为点击：查找点击位置下的站点
      handleStationClick(e.clientX, e.clientY)
    }
    clickStart.value = null
  }
}

function handleStationClick(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return
  const world = svgPointFromClient(clientX, clientY)
  if (!world) return
  const wx = (world.x - tx.value) / scale.value
  const wy = (world.y - ty.value) / scale.value
  const list = stations.value
  let closest = null
  let closestDist = Infinity
  const HIT_RADIUS = 14
  for (const s of list) {
    if (!s.co) continue
    const d = Math.hypot(wx - s.co.x, wy - s.co.y)
    if (d < HIT_RADIUS && d < closestDist) {
      closest = s
      closestDist = d
    }
  }
  if (closest) {
    emit('select-station', closest.id, clientX, clientY)
  }
}

function onSvgClick(e) {
  handleStationClick(e.clientX, e.clientY)
}

const didPan = ref(false)

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
