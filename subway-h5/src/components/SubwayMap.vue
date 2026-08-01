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
          :stroke-width="(highlightLineId && highlightLineId === line.id) ? baseLineWidthHL : baseLineWidth"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          :opacity="lineOpacity(line.id)"
          style="transition: opacity 0.2s, stroke-width 0.2s"
        />
        <!-- 高亮路径段（规划结果线路，优先级最高） -->
        <polyline
          v-for="(seg, i) in highlightPolys"
          :key="'h-' + i"
          :points="seg.points"
          :stroke="seg.color"
          :stroke-width="baseLineWidthHL"
          stroke-linejoin="round"
          stroke-linecap="round"
          fill="none"
          :opacity="routeSegOpacity(seg.lineId)"
        />
        <!-- 站点 -->
        <g v-for="s in stations" :key="'s-' + s.id" :opacity="stationOpacity(s)" style="transition: opacity 0.2s">
          <!-- 换乘站：白底圆 + 细描边 + 内部双向箭头 -->
          <template v-if="s.isTransfer">
            <circle
              :cx="s.x"
              :cy="s.y"
              :r="svgRadius(s)"
              :fill="s.highlight ? s.fill : '#fff'"
              :stroke="s.highlight ? s.stroke : '#1a1d24'"
              :stroke-width="baseStrokeWidth * 0.5"
              @click.stop="$emit('select-station', s.id)"
              style="cursor: pointer"
            />
            <path
              :d="transferIconPath(s.x, s.y, svgRadius(s) * 0.6)"
              fill="none"
              :stroke="(s.highlight && !s.isStart && !s.isEnd) ? '#1a1d24' : s.fill === '#fff' ? '#1a1d24' : '#fff'"
              :stroke-width="baseStrokeWidth * 0.5"
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
            :stroke-width="baseStrokeWidth*0.5"
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
            fill="#1a1d24"
            style="pointer-events: none"
          >{{ s.name }}</text>
        </g>
      </g>
    </svg>

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
  loading: { type: Boolean, default: false },
  highlightLineId: { type: String, default: '' }
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

// 规划结果高亮（起终点连线）的淡化，只在存在规划结果时触发
const routeDimmed = computed(() => props.highlight && props.highlight.length > 0)

// --- 线路/站点淡化透明度逻辑（图例高亮优先于规划结果高亮）---
// 规则：
// 1) 如果有 highlightLineId（图例点了某条线）：
//    - 选中线路 + 其站点：1
//    - 非选中线路：0.2；非选中站点：0.55（换乘站只要跨线含选中也保留）
// 2) 否则如果有规划结果（routeDimmed）：非路径段 0.25
// 3) 否则：全 1
function lineOpacity(lineId) {
  if (props.highlightLineId) {
    return lineId === props.highlightLineId ? 1 : 0.2
  }
  return routeDimmed.value ? 0.25 : 1
}
// 规划路径段（Highlight Polyline）的透明度：图例高亮时也要区分选中的线
function routeSegOpacity(lineId) {
  if (props.highlightLineId) {
    return lineId === props.highlightLineId ? 0.98 : 0.25
  }
  return 0.95
}
// 站点的透明度：换乘站（多线路）只要任一线处于高亮态就保留，否则淡
function stationOpacity(s) {
  if (!props.highlightLineId) return 1
  const lines = s.lines || []
  return lines.includes(props.highlightLineId) ? 1 : 0.55
}

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
const FONT_TARGET = 2 // 屏幕上目标字号（px）—— 尽可能小，避免压住线路
const RADIUS_NORMAL = 1.5   // 普通站屏幕目标半径
const RADIUS_TRANSFER = 1.5 // 换乘站屏幕目标半径
const RADIUS_HIGHLIGHT = 2 // 高亮站屏幕目标半径
const LINE_W = 1       // 线路屏幕目标宽度
const LINE_W_HL = 1.5       // 高亮线路屏幕目标宽度
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

// 所有线路段（用于标签与线路碰撞检测 + 站点吸附）
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

// 点到线段的最近点（用于站点吸附到线路中心线上）
function closestPointOnSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return { x: x1, y: y1 }
  let t = ((px - x1) * dx + (py - y1) * dy)
  t /= dx * dx + dy * dy
  t = Math.max(0, Math.min(1, t))
  return { x: x1 + t * dx, y: y1 + t * dy }
}

// 站点坐标吸附到线路中心线上：每个站点只在自己所属线路的线段中找最近点
// 解决：线路使用自定义 path 但站点用自身 x,y，导致圆圈不居中在线路上
const snappedStationCoords = computed(() => {
  const orig = stationCoords.value
  if (!props.cityData) return orig
  const p = proj.value

  // 构建 stationId -> 该站所属线路的所有线段数组
  const segsByStation = new Map()
  for (const line of props.cityData.lines || []) {
    // 解析该线路的所有线段点（与 linePolys 渲染逻辑一致：path 优先）
    let pts = []
    if (line.path && line.path.length > 0) {
      pts = line.path.map(([x, y]) => p.projectXY(x, y))
    } else {
      pts = (line.stationIds || []).map(id => orig[id]).filter(Boolean)
    }
    // 该线路的所有站点
    for (const sid of line.stationIds || []) {
      if (!segsByStation.has(sid)) segsByStation.set(sid, [])
      const arr = segsByStation.get(sid)
      for (let i = 1; i < pts.length; i++) {
        arr.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y })
      }
    }
  }

  const snapped = {}
  for (const [id, co] of Object.entries(orig)) {
    const segs = segsByStation.get(id)
    // 该站没有线路信息 -> 跳过吸附，使用原坐标
    if (!segs || !segs.length) { snapped[id] = { x: co.x, y: co.y }; continue }
    let bestX = co.x, bestY = co.y, bestD = Infinity
    for (const seg of segs) {
      const q = closestPointOnSeg(co.x, co.y, seg.x1, seg.y1, seg.x2, seg.y2)
      const d = (q.x - co.x) ** 2 + (q.y - co.y) ** 2
      if (d < bestD) { bestD = d; bestX = q.x; bestY = q.y }
    }
    snapped[id] = { x: bestX, y: bestY }
  }
  return snapped
})

// 每个站点ID的线路方向角度（带符号的真实角度），用于标签旋转
// 返回有向角度: -90~90，atan2(y,x)，正值表示线路向右下方倾斜
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
      // 带符号的真实角度，规范化到 (-90, 90] 区间
      let angle = Math.atan2(ay, ax) * 180 / Math.PI
      if (angle > 90) angle -= 180
      if (angle <= -90) angle += 180
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

const stations = computed(() => {
  if (!props.cityData) return []
  // 使用吸附后的坐标（每个站点都投影到了最近线路段上）
  const c = snappedStationCoords.value
  // 按站名去重：同名站（换乘站跨线）只渲染一次
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
    // 白色背景主题：所有站点文字为深色，起点/终点用彩色填充 + 深色描边
    let fill = '#fff'
    let stroke = '#1a1d24'
    if (isStart) { fill = '#22c55e'; stroke = '#1a1d24' }
    else if (isEnd) { fill = '#ef4444'; stroke = '#1a1d24' }
    else if (onRoute) { fill = '#fff'; stroke = '#4a9eff' }
    // 聚合同名站（换乘站）的所有吸附后坐标取平均，使圆圈落在线路交叉几何中心
    let avgX = co.x, avgY = co.y
    if (dupIds.length > 1) {
      let sx = 0, sy = 0, n = 0
      for (const did of dupIds) {
        const dc = c[did]
        if (dc) { sx += dc.x; sy += dc.y; n++ }
      }
      if (n > 1) { avgX = sx / n; avgY = sy / n }
    }
    // 聚合同名站的所有线路方向角度（带符号，-90~90）
    const angleList = dupIds
      .map(did => stationAngles.value.get(did))
      .filter(a => a != null)
    const lineAngle = angleList.length
      ? angleList.reduce((a, b) => a + b, 0) / angleList.length
      : 0
    // 用于判断水平/垂直的绝对值角度（取绝对值供 getCandidates 使用）
    const absLineAngle = Math.abs(lineAngle)
    return {
      id, name: st.name, x: avgX, y: avgY, fill, stroke, highlight,
      isTransfer, lines, lineAngle, absLineAngle
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

// 标签防重叠 7.0（纯水平文字 + 3 级距离 + 严格标签碰撞优先）：
// 1) 按优先级排序：高亮站 > 换乘站 > 普通站，同优先级按字多的先排（大站优先占好位置）
// 2) 3 级距离候选：近距(1×r) → 中距(1.8×r) → 远距(2.8×r)，每级 8 方向，共 24 个位置
// 3) 评分：零标签碰撞 → 压线少 → 距离近；标签碰撞方案最后才用
const labelData = computed(() => {
  const list = stations.value
  const result = new Map()
  if (!list.length) return result

  const sorted = [...list].sort((a, b) => {
    const pa = a.highlight ? 0 : (a.isTransfer ? 1 : 2)
    const pb = b.highlight ? 0 : (b.isTransfer ? 1 : 2)
    if (pa !== pb) return pa - pb
    // 同优先级，名字长的先排（大站名更难找到位置）
    const la = (a.name || '').length
    const lb = (b.name || '').length
    if (lb !== la) return lb - la
    return (b.lines?.length || 0) - (a.lines?.length || 0)
  })

  const fs = baseFontSize.value
  const charW = fs
  const charH = fs * 1.2
  const padX = fs * 0.2
  const padY = fs * 0.15
  const gap = fs * 0.9

  const visR = (s) => svgRadius(s) + baseStrokeWidth.value
  const segs = lineSegments.value

  // 根据线路方向返回 3 级 × 8 方向 = 24 个候选位置（按优先级排序）
  // 近距：r=1×gap；中距：r=1.8×gap；远距：r=3.0×gap
  function getCandidates(s) {
    const isHorizontal = (s.absLineAngle ?? 0) < 45
    const baseR = visR(s) + gap

    function make8(r) {
      const diag = r * 0.707
      const mk = (anchor, ox, oy) => ({ anchor, offsetX: ox, offsetY: oy, dist: r })
      return [
        mk('middle', 0,      -r),                   // top
        mk('middle', 0,       r + charH),           // bot
        mk('start',  diag,  -diag),                 // tr
        mk('end',    -diag, -diag),                 // tl
        mk('start',  diag,   diag + charH),         // br
        mk('end',   -diag,   diag + charH),         // bl
        mk('start',  r,      charH * 0.35),         // right
        mk('end',   -r,      charH * 0.35),         // left
      ]
    }

    const near = make8(baseR)
    const mid  = make8(baseR * 1.8)
    const far  = make8(baseR * 3.0)

    // 水平线：上下优先 → 对角 → 左右；垂直线：左右优先 → 对角 → 上下
    function prioritize(arr) {
      const [top, bot, tr, tl, br, bl, right, left] = arr
      return isHorizontal
        ? [top, bot, tr, tl, br, bl, right, left]
        : [right, left, tr, tl, br, bl, top, bot]
    }

    return [...prioritize(near), ...prioritize(mid), ...prioritize(far)]
  }

  // 计算标签矩形压住的线路段数量（排除经过站点自身的线段）
  function countLineCollisions(s, bx, by, bw, bh) {
    const skipDist = visR(s) + baseLineWidth.value
    const m = fs * 0.8
    let count = 0
    for (const seg of segs) {
      if (pointToSegDist(s.x, s.y, seg.x1, seg.y1, seg.x2, seg.y2) < skipDist) continue
      if (segCrossesRect(seg.x1, seg.y1, seg.x2, seg.y2, bx - m, by - m, bw + m * 2, bh + m * 2)) count++
    }
    return count
  }

  // placed 存储 AABB：{x1,y1,x2,y2}
  const placed = []

  for (const s of sorted) {
    if (!showLabel(s)) { result.set(s.id, { visible: false }); continue }

    const nameLen = (s.name || '').length
    const bw = nameLen * charW + padX * 2
    const bh = charH + padY * 2

    const candidates = getCandidates(s)

    // 四档回退策略：
    // best: 零标签碰撞 + 零线路碰撞
    // fb1:  零标签碰撞 + 线路碰撞 ≤1
    // fb2:  零标签碰撞 + 线路碰撞 ≤3
    // fb3:  零标签碰撞（任意压线，至少不跟别的标签重叠）
    // lastFb: 允许标签碰撞，选压线最少、距离最近的
    let best = null
    let fb1 = null, fb2 = null, fb3 = null
    let lastFb = null

    for (const c of candidates) {
      const tx_ = s.x + c.offsetX
      const ty_ = s.y + c.offsetY

      let bx
      if (c.anchor === 'start') bx = tx_ - padX
      else if (c.anchor === 'end') bx = tx_ - bw + padX
      else bx = tx_ - bw / 2
      const by = ty_ - charH - padY

      // 标签碰撞检测（严格：任何重叠都不允许）
      let labelCollide = false
      for (const r of placed) {
        if (!(bx + bw <= r.x1 || bx >= r.x2 || by + bh <= r.y1 || by >= r.y2)) {
          labelCollide = true
          break
        }
      }

      const lineCol = countLineCollisions(s, bx, by, bw, bh)
      // 评分：压线优先，相同压线则距离近的优先
      const score = (cand) => cand.col * 1000 + cand.dist

      if (!labelCollide) {
        if (lineCol === 0) { best = { c, bx, by, col: 0, dist: c.dist }; break }
        if (lineCol <= 1 && (!fb1 || lineCol < fb1.col || (lineCol === fb1.col && c.dist < fb1.dist))) fb1 = { c, bx, by, col: lineCol, dist: c.dist }
        if (lineCol <= 3 && (!fb2 || lineCol < fb2.col || (lineCol === fb2.col && c.dist < fb2.dist))) fb2 = { c, bx, by, col: lineCol, dist: c.dist }
        if (!fb3 || lineCol < fb3.col || (lineCol === fb3.col && c.dist < fb3.dist)) fb3 = { c, bx, by, col: lineCol, dist: c.dist }
      }
      if (!lastFb || lineCol < lastFb.col || (lineCol === lastFb.col && c.dist < lastFb.dist)) {
        lastFb = { c, bx, by, col: lineCol, dist: c.dist }
      }
    }

    const chosen = best || fb1 || fb2 || fb3 || lastFb
    if (chosen) {
      const { c, bx, by } = chosen
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
