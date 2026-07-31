// 地铁数据准备脚本：从 OpenStreetMap Overpass API 抓取城市地铁线路+站点，生成 data/<city>.json
// 本地运行（Node 18+，内置 fetch），不受浏览器 CORS 限制。
// 用法: node scripts/prepare-data/build_data.mjs [cityId]   不传则生成全部城市
//
// 采用两步查询以降低单次负载（Overpass 主节点常 504）：
//  Step1: 取 subway/light_rail route 关系（含 members，不递归）
//  Step2: 按 node id 批量取站点坐标+名称

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../../public/data')

const CITIES = {
  shenzhen:   { name: '深圳', variants: ['深圳市', '深圳'], prefix: 'sz' },
  guangzhou:  { name: '广州', variants: ['广州市', '广州'], prefix: 'gz' },
  hongkong:   { name: '香港', variants: ['香港', '香港特別行政區', '香港特别行政区', 'Hong Kong'], prefix: 'hk' },
  nanning:    { name: '南宁', variants: ['南宁市', '南宁'], prefix: 'nn' }
}

const PALETTE = [
  '#E4002B', '#0079C2', '#00B189', '#92278F', '#C7A7CB', '#B61D8E',
  '#0678BC', '#E97622', '#43B02A', '#009B77', '#0E4C9E', '#C8102E',
  '#8B1F2E', '#6D6E15', '#A05DA5', '#009A44', '#0F69AC', '#E80074',
  '#00843D', '#0BA8E0', '#FFD800', '#0067B1', '#7B2A3C', '#1A4FA0'
]

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter'
]

const UA = 'subway-h5/0.1 (local data prep; personal use)'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchOverpass(query, { retries = 6 } = {}) {
  let lastErr
  for (const ep of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA
          },
          body: 'data=' + encodeURIComponent(query)
        })
        if ([429, 500, 502, 503, 504].includes(res.status)) {
          const wait = 3000 * (attempt + 1) + Math.random() * 2000
          console.log(`  [${ep.split('/')[2]}] ${res.status}，等待 ${(wait / 1000).toFixed(0)}s 重试 (${attempt + 1}/${retries})...`)
          await sleep(wait)
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (!text.trimStart().startsWith('{')) {
          throw new Error('Non-JSON response (服务器错误页)')
        }
        return JSON.parse(text)
      } catch (e) {
        lastErr = e
        console.log(`  [${ep.split('/')[2]}] 失败: ${e.message}`)
        await sleep(2000 * (attempt + 1))
      }
    }
  }
  throw lastErr || new Error('所有 Overpass 端点均失败')
}

async function fetchCityRaw(cityId) {
  const cfg = CITIES[cityId]
  const areaUnion = cfg.variants.map(n => `area[name="${n}"];`).join('\n  ')

  // Step 1: subway / light_rail route 关系（含 members，不递归）
  const q1 = `
[out:json][timeout:120];
(
  ${areaUnion}
)->.searchArea;
(
  relation["type"="route"]["route"="subway"](area.searchArea);
  relation["type"="route"]["route"="light_rail"](area.searchArea);
);
out body;
`.trim()

  console.log('  Step 1: 获取线路关系...')
  const r1 = await fetchOverpass(q1)
  const relations = (r1.elements || []).filter(
    e => e.type === 'relation' && e.tags?.type === 'route' &&
      (e.tags?.route === 'subway' || e.tags?.route === 'light_rail')
  )

  const nodeIds = new Set()
  for (const rel of relations) {
    for (const m of rel.members || []) {
      if (m.type === 'node') nodeIds.add(m.ref)
    }
  }
  console.log(`  共 ${relations.length} 条线路关系，${nodeIds.size} 个节点待取坐标`)

  // Step 2: 批量取节点坐标 + 名称
  const nodes = []
  const ids = [...nodeIds]
  const BATCH = 300
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const q2 = `[out:json][timeout:120];\nnode(id:${batch.join(',')});\nout body;`
    process.stdout.write(`  Step 2: 节点 ${i + 1}-${Math.min(i + BATCH, ids.length)}... `)
    const r2 = await fetchOverpass(q2)
    let got = 0
    for (const el of r2.elements || []) {
      if (el.type === 'node' && el.lat != null) { nodes.push(el); got++ }
    }
    console.log(`得到 ${got}`)
  }

  return { elements: [...relations, ...nodes] }
}

// 提取线路代号
function lineIdFromName(name, tags) {
  if (tags.ref) return String(tags.ref).replace(/\s+/g, '')
  const n = name || ''
  let m = n.match(/(\d+)\s*号?\s*[线線]/)
  if (m) return m[1]
  m = n.match(/(APM|广佛线|机场线|机场快线|有轨电车|磁浮线|环线|黄埔线|知识城线|南沙线)/)
  if (m) return m[1]
  const en = tags['name:en']
  if (en) {
    const abbr = {
      'Island Line': '港島', 'Tsuen Wan Line': '荃灣', 'Kwun Tong Line': '觀塘',
      'Tseung Kwan O Line': '將軍澳', 'Tung Chung Line': '東涌',
      'Disneyland Resort Line': '迪士尼', 'Airport Express': '機場快線',
      'East Rail Line': '東鐵', 'Tuen Ma Line': '屯馬', 'South Island Line': '南港島'
    }
    if (abbr[en]) return abbr[en]
  }
  return n.replace(/(地铁|地鐵|轨道交通|軌道交通|线|線|号線|號線)/g, '').trim() || n
}

function cleanLineName(name, tags) {
  if (!name) return tags.ref || '未命名线路'
  return name
}

function haversine(a, b) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function buildCity(cityId, raw) {
  const cfg = CITIES[cityId]
  const nodes = new Map()
  const relations = []

  for (const el of raw.elements || []) {
    if (el.type === 'node' && el.lat != null) {
      nodes.set(el.id, { lat: el.lat, lng: el.lon, name: el.tags?.name || el.tags?.['name:zh'] })
    } else if (el.type === 'relation' && el.tags?.type === 'route' && (el.tags?.route === 'subway' || el.tags?.route === 'light_rail')) {
      relations.push(el)
    }
  }

  const lineMap = new Map()
  for (const rel of relations) {
    const name = cleanLineName(rel.tags.name || rel.tags['name:zh'], rel.tags)
    const id = lineIdFromName(name, rel.tags)
    if (!id) continue
    const stopNodes = (rel.members || [])
      .filter(m => m.type === 'node' && (m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only' || m.role === ''))
      .map(m => m.ref)
    if (stopNodes.length < 2) continue
    const color = rel.tags.colour || rel.tags.color
    if (!lineMap.has(id)) lineMap.set(id, { id, name, color, sequences: [] })
    const entry = lineMap.get(id)
    if (!entry.color && color) entry.color = color
    entry.sequences.push(stopNodes)
  }

  const lines = []
  const stationNodeToLines = new Map()
  let colorIdx = 0
  for (const [id, entry] of lineMap) {
    entry.sequences.sort((a, b) => b.length - a.length)
    const main = entry.sequences[0]
    if (!entry.color) entry.color = PALETTE[colorIdx++ % PALETTE.length]
    lines.push({ id, name: entry.name, color: entry.color, stationNodeIds: main })
    for (const nid of main) {
      if (!stationNodeToLines.has(nid)) stationNodeToLines.set(nid, new Set())
      stationNodeToLines.get(nid).add(id)
    }
  }

  const stations = {}
  const nodeIdToStationId = new Map()
  const usedNodeIds = new Set()
  for (const line of lines) for (const nid of line.stationNodeIds) usedNodeIds.add(nid)
  for (const nid of usedNodeIds) {
    const n = nodes.get(nid)
    if (!n || n.lat == null) continue
    const sid = `${cfg.prefix}_${nid}`
    stations[sid] = {
      name: n.name || `站点${nid}`,
      lng: n.lng, lat: n.lat,
      lines: [...(stationNodeToLines.get(nid) || [])]
    }
    nodeIdToStationId.set(nid, sid)
  }

  for (const line of lines) {
    line.stationIds = line.stationNodeIds.map(nid => nodeIdToStationId.get(nid)).filter(Boolean)
    delete line.stationNodeIds
  }

  // 跨站换乘：同名不同站点且距离 < 250m
  const byName = new Map()
  for (const [sid, st] of Object.entries(stations)) {
    if (!byName.has(st.name)) byName.set(st.name, [])
    byName.get(st.name).push(sid)
  }
  const transfers = []
  for (const [, sids] of byName) {
    if (sids.length < 2) continue
    for (let i = 0; i < sids.length; i++) {
      for (let j = i + 1; j < sids.length; j++) {
        const a = stations[sids[i]], b = stations[sids[j]]
        const d = haversine(a, b)
        if (d < 250) transfers.push({ from: sids[i], to: sids[j], walkSec: Math.max(120, Math.round(d)) })
      }
    }
  }

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const st of Object.values(stations)) {
    minLng = Math.min(minLng, st.lng); maxLng = Math.max(maxLng, st.lng)
    minLat = Math.min(minLat, st.lat); maxLat = Math.max(maxLat, st.lat)
  }

  return {
    city: cityId,
    cityName: cfg.name,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap (Overpass API)',
    bounds: { minLng, maxLng, minLat, maxLat },
    lines,
    stations,
    transfers
  }
}

async function buildOne(cityId) {
  const cfg = CITIES[cityId]
  if (!cfg) { console.error('未知城市:', cityId); process.exit(1) }
  console.log(`\n=== 构建 ${cfg.name} (${cityId}) ===`)
  const raw = await fetchCityRaw(cityId)
  const data = buildCity(cityId, raw)
  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = resolve(OUT_DIR, `${cityId}.json`)
  writeFileSync(outPath, JSON.stringify(data))
  const stationCount = Object.keys(data.stations).length
  console.log(`  ✓ 线路 ${data.lines.length} 条，站点 ${stationCount} 个，换乘链接 ${data.transfers.length} 条`)
  console.log(`  → ${outPath}`)
}

async function main() {
  const arg = process.argv[2]
  if (arg) {
    await buildOne(arg)
  } else {
    for (const id of Object.keys(CITIES)) {
      await buildOne(id)
    }
  }
}

main().catch(e => { console.error('构建失败:', e); process.exit(1) })
