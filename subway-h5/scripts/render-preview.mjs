// 生成地铁线路图三方对比预览（纯静态 SVG，无需联网/服务器）。
// 同一城市并排渲染三份数据：
//   高德(示意图) —— 人工优化的示意图坐标（线路平直、布局规整）
//   百度(示意图) —— 百度网页地铁图的示意图坐标 + 官方配色（qt=subways）
//   百度(真实)   —— 百度 BD-09 真实地理坐标（qt=bsi，忠实于真实走向）
// 用法: node scripts/render-preview.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeBounds, makeProjection } from '../src/lib/projection.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../')
const OUT = resolve(ROOT, 'previews/subway-three-way.html')

function loadJson(p) {
  return JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'))
}

function projectPoint(proj, st) {
  if (st.x != null && st.y != null) return proj.projectXY(st.x, st.y)
  return proj.projectStation(st)
}

function linePoints(proj, line, stations) {
  let pts = []
  if (line.path && line.path.length) {
    pts = line.path.map(([x, y]) => proj.projectXY(x, y))
  } else {
    pts = (line.stationIds || [])
      .map(id => stations[id])
      .filter(Boolean)
      .map(st => projectPoint(proj, st))
  }
  return pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function renderMap(cityData, title) {
  const bounds = computeBounds(cityData)
  const proj = makeProjection(bounds, 1000)
  const W = Math.round(proj.width)
  const H = Math.round(proj.height)

  let lineSvg = ''
  for (const line of cityData.lines || []) {
    const pts = linePoints(proj, line, cityData.stations)
    if (!pts) continue
    lineSvg += `<polyline points="${pts}" stroke="${line.color}" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>`
  }

  let stSvg = ''
  let labelSvg = ''
  for (const [sid, st] of Object.entries(cityData.stations || {})) {
    const p = projectPoint(proj, st)
    const isTransfer = (st.lines || []).length >= 2
    if (isTransfer) {
      stSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="#fff" stroke="#1a1d24" stroke-width="1"/>`
      labelSvg += `<text x="${(p.x + 4).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" font-size="9" font-weight="600" fill="#1a1d24">${escapeXml(st.name)}</text>`
    } else {
      stSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.8" fill="#1a1d24"/>`
    }
  }

  let legend = ''
  for (const line of cityData.lines || []) {
    legend += `<div class="lg"><span class="sw" style="background:${line.color}"></span>${escapeXml(line.name)}</div>`
  }

  const stationCount = Object.keys(cityData.stations || {}).length
  const transferCount = Object.values(cityData.stations || {}).filter(s => (s.lines || []).length >= 2).length
  const coordType = cityData.coordType || (st => (st.x != null ? 'schematic' : 'geographic'))(Object.values(cityData.stations || {})[0] || {})

  return `
  <div class="col">
    <div class="map-title">${escapeXml(title)}</div>
    <div class="meta">线路 ${cityData.lines.length} · 站点 ${stationCount} · 换乘 ${transferCount} · ${escapeXml(coordType)}</div>
    <svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${lineSvg}${stSvg}${labelSvg}
    </svg>
    <div class="legend">${legend}</div>
  </div>`
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

const CITIES = [
  {
    id: 'shenzhen', name: '深圳',
    amap: 'public/data-amap/shenzhen.json',
    schematic: 'public/data-baidu-schematic/shenzhen.json',
    geo: 'public/data-baidu/shenzhen.json'
  },
  {
    id: 'guangzhou', name: '广州',
    amap: 'public/data-amap/guangzhou.json',
    schematic: 'public/data-baidu-schematic/guangzhou.json',
    geo: 'public/data-baidu/guangzhou.json'
  }
]

let body = ''
for (const c of CITIES) {
  const amap = loadJson(c.amap)
  const schematic = loadJson(c.schematic)
  const geo = loadJson(c.geo)
  body += `<section><h2>${escapeXml(c.name)} — 三种数据源对比</h2>
    <div class="row">
      ${renderMap(schematic, '百度（示意图）')}
      ${renderMap(amap, '高德（示意图）')}
      ${renderMap(geo, '百度（真实坐标地理位置）')}
    </div></section>`
}

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>地铁线路图 三源对比</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f5f6f8; color:#1a1d24; margin:0; padding:20px; }
  h1 { font-size:20px; } h2 { font-size:16px; margin:24px 0 10px; }
  .row { display:flex; gap:14px; flex-wrap:wrap; }
  .col { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px; flex:1; min-width:300px; }
  .map-title { font-weight:700; font-size:15px; }
  .meta { font-size:11px; color:#888; margin:2px 0 8px; }
  .map { width:100%; height:auto; background:#fff; border-radius:8px; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:8px; max-height:160px; overflow:auto; }
  .lg { font-size:11px; color:#444; display:flex; align-items:center; gap:4px; }
  .sw { width:12px; height:4px; border-radius:2px; display:inline-block; }
  .note { font-size:12px; color:#666; background:#fff7e6; border:1px solid #ffd591; padding:8px 12px; border-radius:8px; margin:10px 0; line-height:1.6; }
</style></head>
<body>
<h1>地铁线路图 · 三种数据源效果对比</h1>
<div class="note">
  <b>百度（示意图）</b>：百度网页地铁图的示意图坐标（qt=subways），带官方线路配色，布局贴近真实走向但经过简化。<br/>
  <b>高德（示意图）</b>：人工优化的示意图坐标，线路平直、布局规整，视觉最干净。<br/>
  <b>百度（真实坐标地理位置）</b>：百度 BD-09 真实经纬度坐标（qt=bsi），忠实于真实地理走向，线路会随地理拐弯、交叉更多。<br/>
  南宁在百度接口暂无地铁数据，故未列入。
</div>
${body}
</body></html>`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, html)
console.log('已生成三源对比预览:', OUT, `( ${(html.length / 1024).toFixed(1)} KB )`)
