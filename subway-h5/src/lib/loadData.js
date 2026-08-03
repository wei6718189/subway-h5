// 按需加载城市数据 JSON
import { computed, ref } from 'vue'

export const CITIES = [
  { id: 'shenzhen', name: '深圳' },
  { id: 'guangzhou', name: '广州' },
  { id: 'nanning', name: '南宁' }
]

// 数据源（地图厂商）
//  - amap:        高德地图「示意图」坐标（srhdata）         → 目录 public/data-amap
//  - baidu:       百度地图「示意图」坐标（qt=subways，含官方配色）→ 目录 public/data-baidu-schematic
//  - baidu-geo:   百度地图「真实地理」坐标（qt=bsi，BD-09 经纬度）  → 目录 public/data-baidu
export const PROVIDERS = [
  { id: 'baidu', name: '百度（示意图）' },
  { id: 'amap', name: '高德（示意图）' },
  { id: 'baidu-geo', name: '百度（真实坐标地理位置）' }
]

// 百度地图（qt=bsi）已抓取数据的城市。
// 注：南宁在百度 bsi 接口暂无地铁数据（返回空），故百度版仅覆盖深圳/广州。
export const BAIDU_CITIES = ['shenzhen', 'guangzhou']

const cache = new Map()

/**
 * 加载城市数据（带内存缓存）
 * @param {string} cityId
 * @param {string} provider 'amap' | 'baidu'
 * @returns {Promise<object>}
 */
export async function loadCity(cityId, provider = 'amap') {
  const key = `${provider}:${cityId}`
  if (cache.has(key)) return cache.get(key)
  // 相对路径，兼容对象存储子目录部署
  const dir =
    provider === 'baidu' ? 'data-baidu-schematic' :
    provider === 'baidu-geo' ? 'data-baidu' :
    'data-amap'
  const url = `./${dir}/${cityId}.json`
  // cache: 'no-store' 强制浏览器永不缓存该 JSON（绕开此前 vite preview 给静态资源打的强缓存），
  // 重新抓取（prepare:*）生成新数据后，任意刷新即可拿到最新数据
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`加载城市数据失败: ${cityId} (${res.status})`)
  const data = await res.json()
  cache.set(key, data)
  return data
}

/**
 * 构建站名 → stationId 列表 的索引（支持同名多站）
 * @param {object} cityData
 */
export function buildStationIndex(cityData) {
  const byName = new Map()
  for (const [sid, st] of Object.entries(cityData.stations || {})) {
    const name = st.name
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(sid)
  }
  return byName
}

/**
 * 模糊搜索站点
 * @param {object} cityData
 * @param {string} query
 * @param {number} limit
 */
export function searchStations(cityData, query, limit = 12) {
  const q = (query || '').trim().toLowerCase()
  const stations = Object.entries(cityData.stations || {})
  if (!q) {
    return stations.slice(0, limit).map(([id, s]) => ({ id, name: s.name, lines: s.lines }))
  }
  const scored = []
  for (const [id, s] of stations) {
    const name = s.name
    const lower = name.toLowerCase()
    let score = -1
    if (lower === q) score = 0
    else if (lower.startsWith(q)) score = 1
    else if (lower.includes(q)) score = 2
    else if (s.pinyin && s.pinyin.toLowerCase().startsWith(q)) score = 3
    if (score >= 0) scored.push({ score, id, name, lines: s.lines })
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'zh'))
  return scored.slice(0, limit).map(({ id, name, lines }) => ({ id, name, lines }))
}
