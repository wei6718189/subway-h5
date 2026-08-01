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
          :stroke-width="baseLineWidth"
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
          :stroke-width="baseLineWidthHL"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          opacity="0.95"
        />
        <!-- 站点 -->
        <g v-for="s in stations" :key="'s-' + s.id">
          <!-- 换乘站：白底大圆 + 描边 + 内部双向箭头 -->
          <template v-if="s.isTransfer">
            <circle
              :cx="s.x"
              :cy="s.y"
              :r="svgRadius(s)"
              :fill="s.highlight ? s.fill : '#fff'"
              :stroke="s.highlight ? s.stroke : '#1a1d24'"
              :stroke-width="baseStrokeWidth"
              @click.stop="$emit('select-station', s.id)"
              style="cursor: pointer"
            />
            <path
              :d="transferIconPath(s.x, s.y, svgRadius(s) * 0.7)"
              fill="none"
              :stroke="s.highlight ? '#fff' : '#1a1d24'"
              :stroke-width="baseStrokeWidth * 0.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              pointer-events="none"
            />
          </template>
          <!-- 普通站 / 起终点：实心圆圈 -->
          <circle
            v-else
            :cx="s.x"
            :cy="s.y"
            :r="svgRadius(s)"
            :fill="s.fill"
            :stroke="s.stroke"
            :stroke-width="baseStrokeWidth"
            @click.stop="$emit('select-station', s.id)"
            style="cursor: pointer"
          />
          <text
            v-if="labelData.get(s.id)?.visible"
            :x="s.x + (labelData.get(s.id)?.dx ?? 0)"
            :y="s.y + (labelData.get(s.id)?.dy ?? 0)"
            :text-anchor="labelData.get(s.id)?.anchor ?? 'start'"
            :font-size="baseFontSize"
            :font-weight="s.isTransfer || s.highlight ? 600 : 400"
            :fill="s.highlight ? '#fff' : 'var(--text)'"
            style="pointer-events: none"
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
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
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

// --- SVG 容器尺寸追踪（用于计算自适应基础尺寸）---
const svgRect = ref({ width: 0, height: 0 })
let resizeObserver = null

// SVG viewBox 适配到容器的缩放比（仅跟设备屏幕尺寸有关，不受用户缩放影响）
const fitScale = computed(() => {
  const vbW = proj.value.width || 1000
  const vbH = proj.value.height || 800
  const { width, height } = svgRect.value
  if (!width || !height) return 1
  return Math.min(width / vbW, height / vbH)
})

// 自适应基础尺寸：使用平方根补偿（部分补偿 fitScale）
// 完全补偿（/fitScale）会导致手机端 SVG 坐标系中值过大，文字比站间距还宽
// 平方根补偿（/sqrt(fitScale)）在手机端折中：屏幕值略小但 SVG 比例合理
// 这些值在 SVG 坐标系中，会随用户缩放（scale）自然等比缩放
const FONT_TARGET = 2  // 屏幕上目标字号（px）—— 尽可能小，避免压住线路
const RADIUS_NORMAL = 1.5   // 普通站屏幕目标半径
const RADIUS_TRANSFER = 2 // 换乘站屏幕目标半径
const RADIUS_HIGHLIGHT = 3 // 高亮站屏幕目标半径
const LINE_W = 1.5        // 线路屏幕目标宽度
const LINE_W_HL = 3       // 高亮线路屏幕目标宽度
const STROKE_W = 0.5       // 站点描边屏幕目标宽度

// 平方根补偿：fitScale=0.375 时补偿因子=1.63（而非完全补偿的 2.67）
function adapt(v) {
  return v / Math.sqrt(fitScale.value || 1)
}

const baseFontSize = computed(() => adapt(FONT_TARGET))
const baseRadiusNormal = computed(() => adapt(RADIUS_NORMAL))
const baseRadiusTransfer = computed(() => adapt(RADIUS_TRANSFER))
const baseRadiusHighlight = computed(() => adapt(RADIUS_HIGHLIGHT))
const baseLineWidth = computed(() => adapt(LINE_W))
const baseLineWidthHL = computed(() => adapt(LINE_W_HL))
const baseStrokeWidth = computed(() => adapt(STROKE_W))

// 站点 SVG 半径（会随用户缩放一起缩放）
function svgRadius(s) {
  if (s.highlight) return baseRadiusHighlight.value
  return s.isTransfer ? baseRadiusTransfer.value : baseRadiusNormal.value
}

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

// 所有线路段（用于标签与线路碰撞检测）
const lineSegments = computed(() => {
  if (!props.cityData) return []
  const p = proj.value
  const segs = []
  for (const line of props.cityData.lines || []) {
    let pts = []
    if (line.path && line.path.length > 0) {
      pts = line.path.map(([x, y]) => p.projectXY(x, y))
    } else {
      const c = stationCoords.value
      pts = (line.stationIds || []).map(id => c[id]).filter(Boolean)
    }
    for (let i = 1; i < pts.length; i++) {
      segs.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y })
    }
  }
  return segs
})

// 每个站点ID的线路方向角度（0=水平, 90=垂直），用于标签垂直放置
const stationAngles = computed(() => {
  const angles = new Map()
  if (!props.cityData) return angles
  const c = stationCoords.value
  for (const line of props.cityData.lines || []) {
    const ids = line.stationIds || []
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const co = c[id]
      if (!co) continue
      const prevCo = i > 0 ? c[ids[i - 1]] : null
      const nextCo = i < ids.length - 1 ? c[ids[i + 1]] : null
      const vectors = []
      if (prevCo) vectors.push([co.x - prevCo.x, co.y - prevCo.y])
      if (nextCo) vectors.push([nextCo.x - co.x, nextCo.y - co.y])
      if (!vectors.length) continue
      let ax = 0, ay = 0
      for (const [vx, vy] of vectors) { ax += vx; ay += vy }
      const angle = Math.atan2(Math.abs(ay), Math.abs(ax)) * 180 / Math.PI
      if (!angles.has(id)) angles.set(id, [])
      angles.get(id).push(angle)
    }
  }
  const result = new Map()
  for (const [id, list] of angles) {
    result.set(id, list.reduce((a, b) => a + b, 0) / list.length)
  }
  return result
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
    // 聚合同名站（换乘站）的所有线路方向角度
    const angleList = dupIds
      .map(did => stationAngles.value.get(did))
      .filter(a => a != null)
    const lineAngle = angleList.length
      ? angleList.reduce((a, b) => a + b, 0) / angleList.length
      : 45
    return {
      id, name: st.name, x: co.x, y: co.y, fill, stroke, highlight,
      isTransfer, lines, lineAngle
    }
  })
})

// 有效缩放比 = 设备适配缩放 × 用户缩放（决定标签密度）
const effectiveScale = computed(() => (fitScale.value || 1) * scale.value)

function showLabel(s) {
  // 有效缩放比低时（如手机端默认视图），仅显示换乘站和高亮站
  // 注：桌面端默认 effectiveScale 通常 > 0.5，普通站会显示
  if (effectiveScale.value < 0.4 && !s.isTransfer && !s.highlight) {
    return false
  }
  return true
}

// 线段-矩形相交检测（用于判断标签是否压住线路）
function segsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (d === 0) return false
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function segCrossesRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  if (x1 >= rx && x1 <= rx + rw && y1 >= ry && y1 <= ry + rh) return true
  if (x2 >= rx && x2 <= rx + rw && y2 >= ry && y2 <= ry + rh) return true
  return (
    segsIntersect(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
    segsIntersect(x1, y1, x2, y2, rx, ry + rh, rx + rw, ry + rh) ||
    segsIntersect(x1, y1, x2, y2, rx, ry, rx, ry + rh) ||
    segsIntersect(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh)
  )
}

// 点到线段的最短距离（用于判断线段是否经过站点）
function pointToSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

// 标签防重叠 5.0（线路方向感知 + 线路碰撞检测）：
// 1) 按优先级排序：高亮站 > 换乘站 > 普通站
// 2) 根据站点线路方向选择垂直方向放置（水平线→上下放, 垂直线→左右放）
// 3) 检测标签与线路碰撞，避免文字压住线路
// 4) 检测标签之间碰撞，避免文字重叠
const labelData = computed(() => {
  const list = stations.value
  const result = new Map()
  if (!list.length) return result

  const sorted = [...list].sort((a, b) => {
    const pa = a.highlight ? 0 : (a.isTransfer ? 1 : 2)
    const pb = b.highlight ? 0 : (b.isTransfer ? 1 : 2)
    if (pa !== pb) return pa - pb
    return (b.lines?.length || 0) - (a.lines?.length || 0)
  })

  const fs = baseFontSize.value
  const charW = fs
  const charH = fs * 1.2
  const padX = fs * 0.15
  const padY = fs * 0.1
  const gap = fs * 0.25

  const visR = (s) => svgRadius(s) + baseStrokeWidth.value
  const segs = lineSegments.value

  // 根据线路方向返回候选位置顺序（8 标准 + 8 远距，共 16 个）
  // 远距候选用于长站名（如4字站名）避开线路
  function getCandidates(s) {
    const isHorizontal = s.lineAngle < 45
    const r = visR(s) + gap
    const diag = r * 0.707
    const r2 = r * 1.8       // 远距偏移
    const diag2 = r2 * 0.707 // 远距对角

    const mk = (anchor, ox, oy) => ({ anchor, offsetX: ox, offsetY: oy })
    // 标准距离
    const right = mk('start',  r,      charH * 0.35)
    const left  = mk('end',   -r,      charH * 0.35)
    const top   = mk('middle', 0,      -r)
    const bot   = mk('middle', 0,       r + charH)
    const tr = mk('start',  diag,  -diag)
    const tl = mk('end',    -diag, -diag)
    const br = mk('start',  diag,   diag + charH)
    const bl = mk('end',   -diag,   diag + charH)
    // 远距（为长站名提供更多空间）
    const right2 = mk('start',  r2,      charH * 0.35)
    const left2  = mk('end',   -r2,      charH * 0.35)
    const top2   = mk('middle', 0,       -r2)
    const bot2   = mk('middle', 0,       r2 + charH)
    const tr2 = mk('start',  diag2,  -diag2)
    const tl2 = mk('end',    -diag2, -diag2)
    const br2 = mk('start',  diag2,   diag2 + charH)
    const bl2 = mk('end',   -diag2,   diag2 + charH)

    // 水平线路→优先上下+对角，垂直线路→优先左右+对角，远距候选排在后面
    return isHorizontal
      ? [top, bot, tr, tl, br, bl, right, left, top2, bot2, tr2, tl2, br2, bl2, right2, left2]
      : [right, left, tr, tl, br, bl, top, bot, right2, left2, tr2, tl2, br2, bl2, top2, bot2]
  }

  // 计算标签矩形压住的线路段数量（排除经过站点自身的线段）
  // 标签矩形外扩 margin，让文字与线路保持安全距离
  function countLineCollisions(s, bx, by, bw, bh) {
    const skipDist = visR(s) + baseLineWidth.value
    const m = fs * 0.2 // 安全间距：字号的 20%
    let count = 0
    for (const seg of segs) {
      if (pointToSegDist(s.x, s.y, seg.x1, seg.y1, seg.x2, seg.y2) < skipDist) continue
      if (segCrossesRect(seg.x1, seg.y1, seg.x2, seg.y2, bx - m, by - m, bw + m * 2, bh + m * 2)) count++
    }
    return count
  }

  const placed = []

  for (const s of sorted) {
    if (!showLabel(s)) { result.set(s.id, { visible: false }); continue }

    const nameLen = (s.name || '').length
    const bw = nameLen * charW + padX * 2
    const bh = charH + padY * 2

    const forceShow = s.highlight || s.isTransfer
    const candidates = getCandidates(s)

    // 评分制：遍历所有候选位置
    // 1. 零标签碰撞 + 零线路碰撞 → 直接使用
    // 2. 零标签碰撞 + 压线 ≤1 → 可接受（含普通站）
    // 3. 零标签碰撞 + 压线 ≤3 → 普通站回退（避免长站名完全消失）
    // 4. 有标签碰撞 + 压线最少 → 最后回退（所有站都可，避免完全消失）
    let bestCandidate = null
    let fallback1 = null   // 零标签碰撞 + 压线 ≤1
    let fallback2 = null   // 零标签碰撞 + 压线 ≤3
    let lastFallback = null // 有标签碰撞，压线最少（最后回退）

    for (const c of candidates) {
      const tx_ = s.x + c.offsetX
      const ty_ = s.y + c.offsetY

      let bx
      if (c.anchor === 'start') bx = tx_ - padX
      else if (c.anchor === 'end') bx = tx_ - bw + padX
      else bx = tx_ - bw / 2
      const by = ty_ - charH - padY

      // 检测标签之间的碰撞
      let labelCollide = false
      for (const r of placed) {
        if (!(bx + bw < r.x1 || bx > r.x2 || by + bh < r.y1 || by > r.y2)) {
          labelCollide = true
          break
        }
      }

      const lineCol = countLineCollisions(s, bx, by, bw, bh)

      if (!labelCollide) {
        if (lineCol === 0) {
          bestCandidate = { c, bx, by }
          break
        }
        if (lineCol <= 1 && (!fallback1 || lineCol < fallback1.col)) {
          fallback1 = { c, bx, by, col: lineCol }
        }
        if (lineCol <= 3 && (!fallback2 || lineCol < fallback2.col)) {
          fallback2 = { c, bx, by, col: lineCol }
        }
      }
      // 所有候选都记录压线最少（含标签碰撞），作为最后回退
      if (!lastFallback || lineCol < lastFallback.col) {
        lastFallback = { c, bx, by, col: lineCol }
      }
    }

    if (bestCandidate) {
      const { c, bx, by } = bestCandidate
      placed.push({ x1: bx, y1: by, x2: bx + bw, y2: by + bh })
      result.set(s.id, { visible: true, dx: c.offsetX, dy: c.offsetY, anchor: c.anchor })
    } else if (fallback1) {
      const { c, bx, by } = fallback1
      placed.push({ x1: bx, y1: by, x2: bx + bw, y2: by + bh })
      result.set(s.id, { visible: true, dx: c.offsetX, dy: c.offsetY, anchor: c.anchor })
    } else if (fallback2) {
      const { c, bx, by } = fallback2
      placed.push({ x1: bx, y1: by, x2: bx + bw, y2: by + bh })
      result.set(s.id, { visible: true, dx: c.offsetX, dy: c.offsetY, anchor: c.anchor })
    } else if (lastFallback) {
      // 最后回退：所有位置都有标签碰撞，选压线最少的（确保所有站点都能显示）
      const { c, bx, by } = lastFallback
      placed.push({ x1: bx, y1: by, x2: bx + bw, y2: by + bh })
      result.set(s.id, { visible: true, dx: c.offsetX, dy: c.offsetY, anchor: c.anchor })
    } else {
      result.set(s.id, { visible: false })
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
  const HIT_RADIUS = baseRadiusTransfer.value * 2
  for (const s of list) {
    const d = Math.hypot(wx - s.x, wy - s.y)
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

onMounted(() => {
  const svg = svgRef.value
  if (svg) {
    const updateRect = () => {
      const rect = svg.getBoundingClientRect()
      svgRect.value = { width: rect.width, height: rect.height }
    }
    updateRect()
    resizeObserver = new ResizeObserver(updateRect)
    resizeObserver.observe(svg)
  }
  resetView()
})

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect()
})
</script>
