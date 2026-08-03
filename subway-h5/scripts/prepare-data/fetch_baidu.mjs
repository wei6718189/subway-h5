// 地铁数据准备脚本：从百度地图内部接口（qt=bsi）抓取城市地铁线路+站点，生成 data-baidu/<city>.json
//
// 数据来源说明：
//   百度地图网页端线路的真正数据源是 map.baidu.com 的 qt=bsi 接口，返回 content 数组，
//   每条线路含 line_name / line_uid / pair_line_uid / stops[]，每个站点含 name / uid / x / y。
//   其中 x / y 是「百度墨卡托坐标（BD-09MC）」，本脚本将其转换为百度经纬度（BD-09LL），
//   作为 lng / lat 存入，渲染时走「地理坐标」投影（与高德示意图坐标不同，百度是真实地理布局）。
//
// 与高德版的关键差异（也是本任务要对比的「效果」）：
//   - 高德 fetch_amap.mjs：人工优化的「示意图坐标」（x/y），线路平滑、布局规整；
//   - 百度本接口：仅给真实地理坐标，渲染出的地铁图忠实于真实地理走向（线路会拐弯、站点贴合实际位置）。
//
// 数据处理要点：
//   1) 双向去重：百度同一条线会返回正向/反向两条（站名相同、顺序相反），按「站名集合」归并；
//   2) 过滤非地铁线路：剔除「城际」「快车/大站」等城际铁路与快车变体，只保留地铁/有轨电车等；
//   3) 换乘站合并：同名站点跨线合并为一个 stationId，lines 累加，isTransfer = 跨 >=2 线。
//
// 本地运行（Node 18+，内置 fetch），一次性下载保存本地，运行时离线可用，无 CORS 问题。
// 用法: node scripts/prepare-data/fetch_baidu.mjs [cityId]   不传则生成全部城市
//
// 注意：需 https + Referer 头，否则返回空。

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../public/data-baidu')

// 百度城市代码（与高德/行政区划代码不同，是百度自有编码）
// 注：南宁在百度 bsi 接口暂无地铁数据（返回空），故百度版仅覆盖深圳/广州。
const CITIES = {
  shenzhen:  { name: '深圳', baiduCode: '340', prefix: 'sz' },
  guangzhou: { name: '广州', baiduCode: '257', prefix: 'gz' }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const REFERER = 'https://map.baidu.com/'

const PALETTE = [
  '#E4002B', '#0079C2', '#00B189', '#92278F', '#C7A7CB', '#B61D8E',
  '#0678BC', '#E97622', '#43B02A', '#009B77', '#0E4C9E', '#C8102E',
  '#8B1F2E', '#6D6E15', '#A05DA5', '#009A44', '#0F69AC', '#E80074',
  '#00843D', '#0BA8E0', '#FFD800', '#0067B1', '#7B2A3C', '#1A4FA0'
]

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/**
 * 百度墨卡托（BD-09MC）→ 百度经纬度（BD-09LL）
 */
function bdMC2LL(x, y) {
  const lng = (x / 20037508.34) * 180
  let lat = (y / 20037508.34) * 180
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2)
  return [lng, lat]
}

// 去掉线路名末尾的「(起点-终点)」方向段，得到干净的线路名
function cleanLineName(raw) {
  let n = String(raw || '')
  n = n.replace(/\([^()]*-[^()]*\)\s*$/, '').trim()
  return n || raw
}

// 是否为地铁/有轨电车类线路（剔除城际铁路、快车变体）
function isMetroLine(name) {
  if (/城际/.test(name)) return false
  if (/快车|大站/.test(name)) return false
  return true
}

function lineIdFromName(name, idx) {
  const base = String(name)
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
    .slice(0, 12)
  return `bd_${base || idx}`
}

async function fetchBaidu(cityId) {
  const cfg = CITIES[cityId]
  const ts = Date.now()
  const url = `https://map.baidu.com/?qt=bsi&c=${cfg.baiduCode}&t=${ts}000`
  console.log(`  请求: ${url}`)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'application/json, text/plain, */*' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error('非 JSON 响应（可能被限流或需鉴权）: ' + text.slice(0, 200))
  }
  if (!data.content || !Array.isArray(data.content)) {
    throw new Error('接口未返回 content 数组，可能城市代码有误: ' + JSON.stringify(Object.keys(data)))
  }
  return data
}

function buildCity(cityId, raw) {
  const cfg = CITIES[cityId]

  // ---- 1) 过滤非地铁线路 ----
  const metroEntries = (raw.content || []).filter(e => isMetroLine(e.line_name || ''))

  // ---- 2) 双向去重：按「站名集合」归并（正向/反向站名相同、顺序相反）----
  const lineGroups = new Map() // key=排序后的站名串 → 选 stops 最多的那条
  for (const entry of metroEntries) {
    const stops = entry.stops || []
    if (stops.length < 2) continue
    const nameKey = stops.map(s => s.name).sort().join('|')
    const existing = lineGroups.get(nameKey)
    if (!existing || stops.length > existing.stops.length) {
      lineGroups.set(nameKey, entry)
    }
  }

  // ---- 3) 按干净线路名排序，保证配色稳定 ----
  const entries = [...lineGroups.values()].sort((a, b) =>
    cleanLineName(a.line_name).localeCompare(cleanLineName(b.line_name), 'zh'))

  const lines = []
  const stations = {}
  const nameToStationId = {}
  let colorIdx = 0
  let lineSeq = 0

  for (const entry of entries) {
    const cleanName = cleanLineName(entry.line_name)
    let lineId = lineIdFromName(cleanName, lineSeq++)
    let dup = 1, baseId = lineId
    while (lines.some(l => l.id === lineId)) {
      lineId = `${baseId}_${dup++}`
    }
    const color = PALETTE[colorIdx++ % PALETTE.length]

    const stationIds = []
    for (const st of entry.stops || []) {
      const name = st.name
      if (!name) continue
      let lng = null, lat = null
      if (st.x != null && st.y != null) {
        ;[lng, lat] = bdMC2LL(Number(st.x), Number(st.y))
      }
      if (lng == null || lat == null || !isFinite(lng) || !isFinite(lat)) continue

      let sid = nameToStationId[name]
      if (!sid) {
        sid = `${cfg.prefix}_${st.uid || Object.keys(stations).length + 1}`
        nameToStationId[name] = sid
        stations[sid] = { name, lng, lat, lines: [], isTransfer: false }
      }
      if (!stations[sid].lines.includes(lineId)) {
        stations[sid].lines.push(lineId)
      }
      stationIds.push(sid)
    }

    if (stationIds.length < 2) continue
    lines.push({ id: lineId, name: cleanName, color, stationIds })
  }

  // 换乘站标记
  for (const st of Object.values(stations)) {
    st.isTransfer = st.lines.length >= 2
  }

  // 计算地理 bounds
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const st of Object.values(stations)) {
    minLng = Math.min(minLng, st.lng); maxLng = Math.max(maxLng, st.lng)
    minLat = Math.min(minLat, st.lat); maxLat = Math.max(maxLat, st.lat)
  }

  return {
    city: cityId,
    cityName: cfg.name,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: '百度地图（qt=bsi 地铁数据，BD-09 坐标）',
    coordType: 'bd09',
    bounds: { minLng, maxLng, minLat, maxLat },
    lines,
    stations,
    transfers: []
  }
}

async function buildOne(cityId) {
  const cfg = CITIES[cityId]
  if (!cfg) { console.error('未知城市:', cityId); process.exit(1) }
  console.log(`\n=== 抓取 ${cfg.name} (${cityId}) 百度地铁数据 ===`)
  const raw = await fetchBaidu(cityId)
  const data = buildCity(cityId, raw)
  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = resolve(OUT_DIR, `${cityId}.json`)
  writeFileSync(outPath, JSON.stringify(data))
  const stationCount = Object.keys(data.stations).length
  const transferCount = Object.values(data.stations).filter(s => s.isTransfer).length
  const withMulti = data.lines.length
  console.log(`  ✓ 线路 ${withMulti} 条，站点 ${stationCount} 个（换乘站 ${transferCount} 个）`)
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
