// 按需加载城市数据 JSON
import { computed, ref } from 'vue'

export const CITIES = [
  { id: 'shenzhen', name: '深圳' },
  { id: 'guangzhou', name: '广州' },
  { id: 'nanning', name: '南宁' }
]

const cache = new Map()

/**
 * 加载城市数据（带内存缓存）
 * @param {string} cityId
 * @returns {Promise<object>}
 */
export async function loadCity(cityId) {
  if (cache.has(cityId)) return cache.get(cityId)
  // 相对路径，兼容对象存储子目录部署
  const url = `./data/${cityId}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载城市数据失败: ${cityId} (${res.status})`)
  const data = await res.json()
  cache.set(cityId, data)
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
