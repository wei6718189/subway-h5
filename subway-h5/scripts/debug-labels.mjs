// 调试：模拟 SubwayMap.vue 中的 labelData 算法
// 针对用户指出的4个站：侨城北、安托山、侨香、香蜜

import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync('./public/data/shenzhen.json', 'utf8'))
const stationsRaw = data.stations
const lines = data.lines

// ========= 1. 复现 stationAngles（每个站的线路角度）【修复版：拐点站取更长段角度】 =========
function computeStationAngles() {
  const angles = new Map() // stationId -> angle array
  function normAngle(a) {
    if (a > 90) a -= 180
    if (a <= -90) a += 180
    return a
  }
  for (const line of lines) {
    const ids = line.stationIds || []
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const co = stationsRaw[id]
      if (!co) continue
      const prevCo = i > 0 ? stationsRaw[ids[i - 1]] : null
      const nextCo = i < ids.length - 1 ? stationsRaw[ids[i + 1]] : null
      const prevVec = prevCo ? [co.x - prevCo.x, co.y - prevCo.y] : null
      const nextVec = nextCo ? [nextCo.x - co.x, nextCo.y - co.y] : null
      let angle
      if (prevVec && nextVec) {
        const prevAng = Math.atan2(prevVec[1], prevVec[0]) * 180 / Math.PI
        const nextAng = Math.atan2(nextVec[1], nextVec[0]) * 180 / Math.PI
        let diff = Math.abs(nextAng - prevAng)
        if (diff > 180) diff = 360 - diff
        const prevLen = Math.hypot(prevVec[0], prevVec[1])
        const nextLen = Math.hypot(nextVec[0], nextVec[1])
        if (diff < 30) {
          const ax = prevVec[0] + nextVec[0], ay = prevVec[1] + nextVec[1]
          angle = Math.atan2(ay, ax) * 180 / Math.PI
        } else {
          // 急转弯：取后段的角度（后段代表后续多站的连续走向，前段通常是拐弯过来的）
          angle = nextAng
        }
      } else if (nextVec) {
        angle = Math.atan2(nextVec[1], nextVec[0]) * 180 / Math.PI
      } else if (prevVec) {
        angle = Math.atan2(prevVec[1], prevVec[0]) * 180 / Math.PI
      } else {
        continue
      }
      angle = normAngle(angle)
      if (!angles.has(id)) angles.set(id, [])
      angles.get(id).push(angle)
    }
  }
  const result = new Map()
  for (const [id, list] of angles) {
    result.set(id, list.reduce((a, b) => a + b, 0) / list.length)
  }
  return result
}
const stationAngles = computeStationAngles()

// ========= 2. 复现 stations 列表（按站名去重，换乘站取平均） =========
function buildStationsList() {
  const byName = new Map()
  for (const [id, st] of Object.entries(stationsRaw)) {
    const co = { x: st.x, y: st.y } // 简化：不用 snapped，用原始坐标即可分析
    if (!byName.has(st.name)) {
      byName.set(st.name, { id, st, co, dupIds: [] })
    }
    byName.get(st.name).dupIds.push(id)
  }
  return [...byName.values()].map(({ id, st, co, dupIds }) => {
    const stLines = st.lines || []
    const isTransfer = stLines.length >= 2
    let avgX = co.x, avgY = co.y
    if (dupIds.length > 1) {
      let sx = 0, sy = 0, n = 0
      for (const did of dupIds) {
        const dc = stationsRaw[did]
        if (dc) { sx += dc.x; sy += dc.y; n++ }
      }
      if (n > 1) { avgX = sx / n; avgY = sy / n }
    }
    const angleList = dupIds.map(did => stationAngles.get(did)).filter(a => a != null)
    const lineAngle = angleList.length ? angleList.reduce((a, b) => a + b, 0) / angleList.length : 0
    const absLineAngle = Math.abs(lineAngle)
    return {
      id, name: st.name, x: avgX, y: avgY,
      isTransfer, lines: stLines,
      lineAngle, absLineAngle,
      highlight: false,
      dupIds
    }
  })
}
const allStations = buildStationsList()

// ========= 3. 复现 lineSegments（所有线路段） =========
function buildLineSegments() {
  const segs = []
  for (const line of lines) {
    let pts = []
    if (line.path && line.path.length > 0) {
      pts = line.path.map(([x, y]) => ({ x, y }))
    } else {
      pts = (line.stationIds || []).map(id => stationsRaw[id]).filter(Boolean)
    }
    for (let i = 1; i < pts.length; i++) {
      segs.push({ x1: pts[i-1].x, y1: pts[i-1].y, x2: pts[i].x, y2: pts[i].y })
    }
  }
  return segs
}
const segs = buildLineSegments()

// ========= 4. 几何辅助函数 =========
function segsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (d === 0) return false
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x4 - x3)) / d
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
function pointToSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

// ========= 5. 算法参数（与 SubwayMap.vue 中一致） =========
const baseFontSize = 14  // 假设 baseFontSize，手机端可能不同，但比例一致
const charW = baseFontSize
const charH = baseFontSize * 1.2
const padX = baseFontSize * 0.2
const padY = baseFontSize * 0.15
const gap = baseFontSize * 0.9
const baseStrokeWidth = 2.5
const baseLineWidth = 2.5
function svgRadius(s) { return s.isTransfer ? 9 : 6 } // 简化近似
const visR = (s) => svgRadius(s) + baseStrokeWidth

// ========= 6. 候选位生成 =========
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

  function prioritize(arr) {
    const [top, bot, tr, tl, br, bl, right, left] = arr
    if (s.isTransfer) return [tr, tl, br, bl, right, left, top, bot]
    return isHorizontal
      ? [top, bot, tr, tl, br, bl, right, left]
      : [right, left, tr, tl, br, bl, top, bot]
  }
  return [...prioritize(near), ...prioritize(mid), ...prioritize(far)]
}

const DIR_NAMES = ['top(上)', 'bot(下)', 'tr(右上)', 'tl(左上)', 'br(右下)', 'bl(左下)', 'right(右)', 'left(左)']
const LEVEL_NAMES = ['近', '中', '远']
function candidateInfo(c, idx) {
  const level = LEVEL_NAMES[Math.floor(idx / 8)]
  const dirIdx = [
    [0,-1],[0,1],[1,-1],[-1,-1],[1,1],[-1,1],[1,0],[-1,0]
  ].findIndex(([ox, oy]) => {
    // 根据 offsetX/Y 符号匹配
    const sx = Math.sign(c.offsetX), sy = Math.sign(c.offsetY)
    return sx === ox && sy === oy
  })
  return `${level}-${DIR_NAMES[dirIdx >= 0 ? dirIdx : idx % 8]}`
}

// ========= 7. 压线计数 =========
function countLineCollisions(s, bx, by, bw, bh) {
  const skipDist = s.isTransfer ? svgRadius(s) * 1.2 : visR(s) + baseLineWidth
  const m = s.isTransfer ? baseFontSize * 1.2 : baseFontSize * 0.8
  let count = 0
  for (const seg of segs) {
    if (pointToSegDist(s.x, s.y, seg.x1, seg.y1, seg.x2, seg.y2) < skipDist) continue
    if (segCrossesRect(seg.x1, seg.y1, seg.x2, seg.y2, bx - m, by - m, bw + m * 2, bh + m * 2)) count++
  }
  return count
}

// ========= 8. 完整算法模拟 =========
const targets = ['侨城北', '安托山', '侨香', '香蜜']
const targetSet = new Set(targets)

// 排序（与 labelData 中一致）
const sorted = [...allStations].sort((a, b) => {
  const pa = a.highlight ? 0 : (a.isTransfer ? 1 : 2)
  const pb = b.highlight ? 0 : (b.isTransfer ? 1 : 2)
  if (pa !== pb) return pa - pb
  const la = (a.name || '').length
  const lb = (b.name || '').length
  if (lb !== la) return lb - la
  return (b.lines?.length || 0) - (a.lines?.length || 0)
})

console.log('=== 排序过程（节选 target + 排序前后的站） ===')
sorted.forEach((s, i) => {
  if (targetSet.has(s.name)) {
    const prev = sorted[i-1] ? sorted[i-1].name : '-'
    const next = sorted[i+1] ? sorted[i+1].name : '-'
    console.log(`#${i+1} ${s.name}  [前站: ${prev} | 后站: ${next}]  isTransfer=${s.isTransfer} nameLen=${s.name.length} lines=${s.lines.length}`)
  }
})
console.log()

const placed = []
const result = new Map()

// 为了调试，我们记录下每个 target 的所有候选位详情
const debugLogs = {}

for (const s of sorted) {
  const nameLen = (s.name || '').length
  const bw = nameLen * charW + padX * 2
  const bh = charH + padY * 2

  const candidates = getCandidates(s)
  let best = null, fb1 = null, fb2 = null, fb3 = null, lastFb = null

  const candLog = []

  candidates.forEach((c, idx) => {
    const tx_ = s.x + c.offsetX
    const ty_ = s.y + c.offsetY
    let bx
    if (c.anchor === 'start') bx = tx_ - padX
    else if (c.anchor === 'end') bx = tx_ - bw + padX
    else bx = tx_ - bw / 2
    const by = ty_ - charH - padY

    let labelCollide = false
    let collideWith = []
    for (const r of placed) {
      if (!(bx + bw <= r.x1 || bx >= r.x2 || by + bh <= r.y1 || by >= r.y2)) {
        labelCollide = true
        collideWith.push(r.name)
        break
      }
    }

    const lineCol = countLineCollisions(s, bx, by, bw, bh)
    candLog.push({
      idx, info: candidateInfo(c, idx),
      anchor: c.anchor,
      ox: Math.round(c.offsetX), oy: Math.round(c.offsetY),
      dist: Math.round(c.dist),
      labelCollide, collideWith: collideWith.join(','),
      lineCol
    })

    if (!labelCollide) {
      if (lineCol === 0 && !best) best = { c, bx, by, col: 0, dist: c.dist, idx }
      if (lineCol <= 1 && (!fb1 || lineCol < fb1.col || (lineCol === fb1.col && c.dist < fb1.dist))) fb1 = { c, bx, by, col: lineCol, dist: c.dist, idx }
      if (lineCol <= 3 && (!fb2 || lineCol < fb2.col || (lineCol === fb2.col && c.dist < fb2.dist))) fb2 = { c, bx, by, col: lineCol, dist: c.dist, idx }
      if (!fb3 || lineCol < fb3.col || (lineCol === fb3.col && c.dist < fb3.dist)) fb3 = { c, bx, by, col: lineCol, dist: c.dist, idx }
    }
    if (!lastFb || lineCol < lastFb.col || (lineCol === lastFb.col && c.dist < lastFb.dist)) {
      lastFb = { c, bx, by, col: lineCol, dist: c.dist, idx }
    }
  })

  const chosen = best || fb1 || fb2 || fb3 || lastFb
  let chosenIdx = chosen ? chosen.idx : -1
  let fallbackLevel = best ? 'best' : fb1 ? 'fb1' : fb2 ? 'fb2' : fb3 ? 'fb3' : 'lastFb'

  if (chosen) {
    placed.push({ x1: chosen.bx, y1: chosen.by, x2: chosen.bx + bw, y2: chosen.by + bh, name: s.name })
    result.set(s.id, { visible: true, dx: chosen.c.offsetX, dy: chosen.c.offsetY, anchor: chosen.c.anchor })
  } else {
    result.set(s.id, { visible: false })
  }

  if (targetSet.has(s.name)) {
    debugLogs[s.name] = {
      station: s,
      sortIdx: sorted.indexOf(s),
      isHorizontal: s.absLineAngle < 45,
      bw, bh,
      candLog,
      chosenIdx,
      fallbackLevel
    }
  }
}

// ========= 9. 输出每个 target 的详细分析 =========
for (const name of targets) {
  const log = debugLogs[name]
  if (!log) { console.log(`\n=== ${name} 未找到 ===`); continue }
  const s = log.station
  console.log(`\n${'='.repeat(70)}`)
  console.log(`【${name}】排序 #${log.sortIdx + 1} | 坐标(${Math.round(s.x)}, ${Math.round(s.y)})`)
  console.log(`  isTransfer=${s.isTransfer}  lines=${s.lines.length}条  nameLen=${s.name.length}`)
  console.log(`  lineAngle=${s.lineAngle.toFixed(1)}°  absAngle=${s.absLineAngle.toFixed(1)}°  →  ${log.isHorizontal ? '水平(上下优先)' : '垂直(左右优先)'}`)
  if (s.isTransfer) console.log(`  → 换乘站特殊：优先对角方向 [tr, tl, br, bl]`)
  console.log(`  标签尺寸 ${log.bw.toFixed(0)}×${log.bh.toFixed(0)}px (字宽×高 + padding)`)
  console.log()

  console.log(`  【24 候选位详情】（按算法优先级顺序排列，✅=可能被选中的）`)
  console.log(`  ${'#'.padStart(2)}  ${'位置'.padEnd(10)} ${'anchor'.padEnd(6)} ${'偏移(ox,oy)'.padEnd(14)} ${'距离'.padEnd(5)} 压线条 标签撞  撞的是`)
  console.log(`  ${'─'.repeat(82)}`)
  log.candLog.forEach((c, i) => {
    const mark = (i === log.chosenIdx) ? '✅' : '  '
    const lc = c.labelCollide ? '是' : '否'
    console.log(`  ${mark}${String(i+1).padStart(2)} ${c.info.padEnd(10)} ${c.anchor.padEnd(6)} (${String(c.ox).padStart(4)},${String(c.oy).padStart(4)}) ${String(c.dist).padStart(4)}   ${String(c.lineCol).padStart(3)}    ${lc.padEnd(3)}   ${c.collideWith || '-'}`)
  })
  console.log()
  console.log(`  → 最终选择：候选位#${log.chosenIdx + 1} (${log.candLog[log.chosenIdx]?.info || '-'})，方案=${log.fallbackLevel}`)
  if (log.fallbackLevel !== 'best') {
    const firstBest = log.candLog.find(c => !c.labelCollide && c.lineCol === 0)
    if (!firstBest) {
      console.log(`  ⚠ 原因分析：没有任何候选位满足【无标签碰撞 + 零压线】(best方案不存在)`)
      const anyOk = log.candLog.find(c => !c.labelCollide)
      if (!anyOk) console.log(`     → 所有 24 个位置都与其他标签重叠，只能退到 lastFb (允许标签碰撞)`)
      else console.log(`     → 存在无标签碰撞的位置，但都有压线，最少 ${log.candLog.filter(c=>!c.labelCollide).sort((a,b)=>a.lineCol-b.lineCol)[0]?.lineCol} 条`)
    }
  } else {
    console.log(`  ✓ 理想位置：无碰撞、无压线`)
  }
  console.log(`${'='.repeat(70)}`)
}
