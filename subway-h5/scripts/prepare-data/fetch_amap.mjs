// 地铁数据准备脚本：从高德地铁示意图接口抓取三城数据，生成 data-amap/<city>.json
// 高德返回的 p 字段是示意图坐标（人工优化的布局坐标），cl 是线路颜色，c/f 是线路路径 polyline 点。
// 绘制效果与高德地铁图一致，站点布局清晰，线路平滑。
// 本地运行（Node 18+，内置 fetch），一次性下载保存本地，运行时离线可用，无 CORS 问题。
// 用法: node scripts/prepare-data/fetch_amap.mjs [cityId]   不传则生成全部城市

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../public/data-amap')

// 高德城市代码（省级行政区划代码）+ 拼音
const CITIES = {
  shenzhen:   { name: '深圳', code: '4403', pinyin: 'shenzhen', prefix: 'sz' },
  guangzhou:  { name: '广州', code: '4401', pinyin: 'guangzhou', prefix: 'gz' },
  nanning:    { name: '南宁', code: '4501', pinyin: 'nanning', prefix: 'nn' }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchAmap(cityId) {
  const cfg = CITIES[cityId]
  const url = `http://map.amap.com/service/subway?srhdata=${cfg.code}_drw_${cfg.pinyin}.json`
  console.log(`  请求: ${url}`)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'http://map.amap.com/subway/' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trimStart().startsWith('{')) {
    throw new Error('非 JSON 响应（可能被限流）: ' + text.slice(0, 200))
  }
  return JSON.parse(text)
}

// 默认调色板（高德数据部分线路可能缺少颜色）
const PALETTE = [
  '#E4002B', '#0079C2', '#00B189', '#92278F', '#C7A7CB', '#B61D8E',
  '#0678BC', '#E97622', '#43B02A', '#009B77', '#0E4C9E', '#C8102E',
  '#8B1F2E', '#6D6E15', '#A05DA5', '#009A44', '#0F69AC', '#E80074'
]

// 解析 "x y" 字符串为 {x, y}
function parseXY(s) {
  const parts = String(s || '').split(/\s+/)
  const x = parseFloat(parts[0])
  const y = parseFloat(parts[1])
  return (isNaN(x) || isNaN(y)) ? null : { x, y }
}

function buildCity(cityId, raw) {
  const cfg = CITIES[cityId]
  const lines = []
  const stations = {}
  const nameToStationId = {}
  let colorIdx = 0

  for (const line of raw.l || []) {
    const lineName = line.ln || line.kn || '未命名线路'

    // 颜色：高德 cl 字段（如 "00AB4F"），需加 # 前缀
    let color = line.cl ? '#' + line.cl : ''
    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      color = PALETTE[colorIdx++ % PALETTE.length]
    }

    // 线路 ID：用高德的 li 字段第一个（主线路）
    const liParts = String(line.li || '').split('|').filter(Boolean)
    const lineId = liParts[0] || lineName.replace(/[\/／].*$/, '').trim()

    // 线路路径 polyline 点：从 c 字段或 f[0].c 字段获取
    // 优先取 f[0].c（第一个方向的路径），它通常覆盖整条线路
    let pathCoords = []
    if (Array.isArray(line.f) && line.f.length > 0 && Array.isArray(line.f[0].c)) {
      pathCoords = line.f[0].c
    } else if (Array.isArray(line.c)) {
      pathCoords = line.c
    }
    // 转换为 {x,y} 数组
    const path = pathCoords
      .map(parseXY)
      .filter(Boolean)
      .map(p => [p.x, p.y])

    const stationIds = []
    for (const st of line.st || []) {
      const name = st.n
      if (!name) continue

      const pos = parseXY(st.p)
      if (!pos) continue

      // 解析真实经纬度 sl: "lng,lat"
      let lng = null, lat = null
      if (st.sl) {
        const slParts = String(st.sl).split(',')
        lng = parseFloat(slParts[0])
        lat = parseFloat(slParts[1])
      }

      // 换乘站去重：同名站点合并为一个
      let sid = nameToStationId[name]
      if (!sid) {
        sid = `${cfg.prefix}_${st.si || Object.keys(stations).length + 1}`
        nameToStationId[name] = sid
        stations[sid] = {
          name,
          x: pos.x,
          y: pos.y,
          ...(lng != null && lat != null ? { lng, lat } : {}),
          lines: [],
          isTransfer: false,
          ...(st.sp ? { pinyin: st.sp } : {})
        }
      } else {
        // 已存在的换乘站：补充缺失的经纬度
        const existing = stations[sid]
        if (existing.lng == null && lng != null) {
          existing.lng = lng
          existing.lat = lat
        }
      }

      // 记录线路归属
      if (!stations[sid].lines.includes(lineId)) {
        stations[sid].lines.push(lineId)
      }
      // 高德 t="1" 标记换乘站
      if (st.t === '1' || st.t === 1) {
        stations[sid].isTransfer = true
      }

      stationIds.push(sid)
    }

    if (stationIds.length < 2) continue

    lines.push({
      id: lineId,
      name: lineName,
      color,
      stationIds,
      ...(path.length > 0 ? { path } : {})
    })
  }

  // 换乘链接：同名站点已合并为同一 stationId，换乘关系通过 station.lines 体现
  const transfers = []

  // 计算示意图坐标范围
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const st of Object.values(stations)) {
    minX = Math.min(minX, st.x)
    maxX = Math.max(maxX, st.x)
    minY = Math.min(minY, st.y)
    maxY = Math.max(maxY, st.y)
  }

  return {
    city: cityId,
    cityName: cfg.name,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: '高德地图（地铁示意图数据）',
    coordType: 'schematic',  // 标记为示意图坐标（区别于真实经纬度）
    bounds: { minX, maxX, minY, maxY },
    lines,
    stations,
    transfers
  }
}

async function buildOne(cityId) {
  const cfg = CITIES[cityId]
  if (!cfg) { console.error('未知城市:', cityId); process.exit(1) }
  console.log(`\n=== 抓取 ${cfg.name} (${cityId}) ===`)
  const raw = await fetchAmap(cityId)
  const data = buildCity(cityId, raw)
  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = resolve(OUT_DIR, `${cityId}.json`)
  writeFileSync(outPath, JSON.stringify(data))
  const stationCount = Object.keys(data.stations).length
  const transferCount = Object.values(data.stations).filter(s => s.isTransfer).length
  const withPath = data.lines.filter(l => l.path && l.path.length > 0).length
  console.log(`  ✓ 线路 ${data.lines.length} 条（含路径 ${withPath} 条），站点 ${stationCount} 个（换乘站 ${transferCount} 个）`)
  console.log(`  → ${outPath}`)
}

async function main() {
  const arg = process.argv[2]
  if (arg) {
    await buildOne(arg)
  } else {
    for (const id of Object.keys(CITIES)) {
      await buildOne(id)
      await sleep(500)
    }
  }
}

main().catch(e => { console.error('构建失败:', e); process.exit(1) })
