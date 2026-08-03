// 抓取百度地图「地铁示意图」数据（qt=subways 接口）
// 与 qt=bsi（真实地理坐标）不同，qt=subways 返回的是百度网页地铁图的示意图坐标：
//   - <l> 线路带官方配色 lc（如 0x6FBD78）
//   - <p> 站点带示意图坐标 x/y（画布坐标）以及真实墨卡托 px/py
//   - <p> 的 ln 字段直接给出换乘关系（“城市|线路名,城市|线路名”）
// 输出与现有渲染器完全兼容的 JSON（站点用 x/y，走 schematic 投影）。
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../')
const OUT_DIR = path.join(ROOT, 'public', 'data-baidu-schematic')

// 百度城市代码（与 qt=bsi 同一套）
const BAIDU_CITY_CODE = { shenzhen: 340, guangzhou: 257, nanning: 326 }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

// 按「城市 → 站名」注入 labelOverride，用于修正手机端标签被算法推远的问题
// 与高德数据格式保持一致：{ position: 'top'|'bot'|'left'|'right'|'tl'|'tr'|'bl'|'br', distance: 'near'|'mid'|'far' }
const LABEL_OVERRIDES = {
  shenzhen: {
    '桥头西': { position: 'bot', distance: 'near' },
    '福海西': { position: 'top', distance: 'near' },
    '国展南': { position: 'bl', distance: 'near' },
    '沙井西': { position: 'bot', distance: 'near' },
    '福永': { position: 'right', distance: 'near' },
    '桥头': { position: 'right', distance: 'near' }
  },
  guangzhou: {}
}

// 官方 lc 缺失时的兜底调色板
const PALETTE = [
  '#E4002B', '#0072CE', '#00A651', '#F39700', '#92278F', '#00A0E9',
  '#A0C400', '#E5007F', '#8B5A2B', '#6FBD78', '#74BAD9', '#D66A62',
  '#AB7BAD', '#7CC5B7', '#B2735A', '#F2C200', '#5C7CBA', '#C0A062',
  '#8E44AD', '#16A085', '#C0392B', '#27AE60'
]

function fetchXml(url) {
  return execFileSync('curl', ['-s', '-m', '25', '-A', UA, '-e', 'https://map.baidu.com/', url], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
}

function hexColor(lc) {
  if (!lc) return null
  return lc.replace(/^0x/i, '#').toUpperCase()
}

// 解析线路与站点（线路归属在 fetchCity 中按真实 line.id 注入，不依赖 ln 字段原始名）
function parseLines(xml) {
  const lines = []
  const lineRe = /<l\s+([^>]*)>([\s\S]*?)<\/l>/g
  let m
  while ((m = lineRe.exec(xml))) {
    const attrs = m[1]
    const inner = m[2]
    const lb = (attrs.match(/lb="([^"]*)"/) || [])[1]
    const lc = (attrs.match(/lc="([^"]*)"/) || [])[1]
    if (!lb) continue
    const stops = []
    const pRe = /<p\s+([^>]*)\/?>/g
    let p
    while ((p = pRe.exec(inner))) {
      const pa = p[1]
      const sid = (pa.match(/sid="([^"]*)"/) || [])[1]
      const x = parseFloat((pa.match(/x="([^"]*)"/) || [])[1])
      const y = parseFloat((pa.match(/y="([^"]*)"/) || [])[1])
      const uid = (pa.match(/uid="([^"]*)"/) || [])[1]
      if (!sid || Number.isNaN(x) || Number.isNaN(y)) continue
      stops.push({ sid, x, y, uid })
    }
    lines.push({ name: lb, color: hexColor(lc), stops })
  }
  return lines
}

function isMetroLike(name) {
  // 与高德口径对齐：保留地铁/APM/广佛/佛山地铁等城市轨道交通；
  // 剔除有轨电车、城际铁路，避免与地铁线路重叠/缠绕（如深圳龙华有轨电车）。
  if (/有轨电车/.test(name)) return false
  if (/城际/.test(name)) return false
  return true
}

async function fetchCity(cityId, code) {
  const url = `https://map.baidu.com/?qt=subways&c=${code}&t=${Date.now()}000`
  const xml = fetchXml(url)
  const rawLines = parseLines(xml).filter(l => isMetroLike(l.name))

  const stations = {}
  const nameToMain = {} // 站名（或坐标兜底）→ 主 station id（用于合并换乘站）
  const outLines = []
  let colorIdx = 0

  for (const rl of rawLines) {
    const color = rl.color || PALETTE[colorIdx % PALETTE.length]
    colorIdx++
    const stationIds = []
    for (const st of rl.stops) {
      // 合并键优先用站名（与高德一致，能容忍不同线路上坐标偏差）；无名时退回坐标
      const nameKey = st.sid && st.sid.trim() ? st.sid.trim() : `${st.x},${st.y}`
      let mainId = nameToMain[nameKey]
      if (mainId == null) {
        // 用站名（或坐标兜底）作主 id，不要用 uid：百度个别站点会复用他人 uid，
        // 例如 5 号线「桂湾」复用了「宝华」的 uid，用 uid 作 id 会把桂湾错误合并进宝华，
        // 表现为桂湾丢失、宝华在 5 号线里被计两次。站名在深圳/广州全局唯一，适合做合并键与 id。
        mainId = nameKey
        nameToMain[nameKey] = mainId
      }
      if (!stations[mainId]) {
        stations[mainId] = { id: mainId, name: st.sid, x: st.x, y: st.y, lines: new Set() }
      }
      // 关键：用线路的【真实 id】(rl.name) 作为归属线路，必须与 ride 边里的 line.id 完全一致，
      // 否则换乘边会指向一个不存在的线路节点（之前用 ln 字段原始名"地铁12号线"导致 71/76 换乘断裂）
      stations[mainId].lines.add(rl.name)
      stationIds.push(mainId)
    }
    outLines.push({ id: rl.name, name: rl.name, color, stationIds })
  }

  const finalStations = {}
  let transfer = 0
  const cityOverrides = LABEL_OVERRIDES[cityId] || {}
  for (const [id, s] of Object.entries(stations)) {
    const linesArr = [...s.lines]
    if (linesArr.length === 0) continue // 过滤被有轨电车/城际独占的孤儿站
    const obj = {
      id,
      name: s.name,
      x: s.x,
      y: s.y,
      lines: linesArr,
      isTransfer: linesArr.length > 1
    }
    const ov = cityOverrides[s.name]
    if (ov) obj.labelOverride = ov
    finalStations[id] = obj
    if (linesArr.length > 1) transfer++
  }
  return { lines: outLines, stations: finalStations, transfer }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const [cityId, code] of Object.entries(BAIDU_CITY_CODE)) {
    if (cityId === 'nanning') {
      console.log(`- ${cityId}: 百度无地铁数据，跳过`)
      continue
    }
    try {
      const data = await fetchCity(cityId, code)
      const out = {
        coordType: 'schematic-baidu',
        source: 'baidu-subways',
        lines: data.lines,
        stations: data.stations
      }
      fs.writeFileSync(path.join(OUT_DIR, `${cityId}.json`), JSON.stringify(out, null, 2))
      console.log(`✓ ${cityId}: ${data.lines.length} 线, ${Object.keys(data.stations).length} 站, ${data.transfer} 换乘`)
    } catch (e) {
      console.error(`✗ ${cityId} 失败:`, e.message)
    }
  }
}

main()
