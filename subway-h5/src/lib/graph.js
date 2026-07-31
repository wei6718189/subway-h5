// 地铁站点图构建 + Dijkstra 最短路径
// 节点 key: `${stationId}@${lineId}`（同站不同线为不同节点，便于换乘计权）

const DEFAULT_RIDE_SEC = 150 // 站间平均 2.5 分钟
const DEFAULT_TRANSFER_SEC = 240 // 同站换乘平均 4 分钟

/**
 * 从城市数据构建邻接表
 * @param {object} cityData
 * @returns {Map<string, Array<{to:string, weight:number, type:'ride'|'transfer'}>>}
 */
export function buildGraph(cityData) {
  const adj = new Map()
  const addEdge = (a, b, weight, type) => {
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push({ to: b, weight, type })
  }

  // 1) 同线相邻站点
  for (const line of cityData.lines || []) {
    const ids = line.stationIds || []
    for (let i = 0; i < ids.length - 1; i++) {
      const a = `${ids[i]}@${line.id}`
      const b = `${ids[i + 1]}@${line.id}`
      addEdge(a, b, DEFAULT_RIDE_SEC, 'ride')
      addEdge(b, a, DEFAULT_RIDE_SEC, 'ride')
    }
  }

  // 2) 同站跨线换乘（同 stationId，多条 line）
  for (const [sid, st] of Object.entries(cityData.stations || {})) {
    const lines = st.lines || []
    if (lines.length > 1) {
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const a = `${sid}@${lines[i]}`
          const b = `${sid}@${lines[j]}`
          addEdge(a, b, DEFAULT_TRANSFER_SEC, 'transfer')
          addEdge(b, a, DEFAULT_TRANSFER_SEC, 'transfer')
        }
      }
    }
  }

  // 3) 跨站换乘（transfer links，如站厅连通的不同站点）
  for (const t of cityData.transfers || []) {
    const sFrom = cityData.stations?.[t.from]
    const sTo = cityData.stations?.[t.to]
    if (!sFrom || !sTo) continue
    const w = t.walkSec || DEFAULT_TRANSFER_SEC
    for (const lf of sFrom.lines || []) {
      for (const lt of sTo.lines || []) {
        const a = `${t.from}@${lf}`
        const b = `${t.to}@${lt}`
        addEdge(a, b, w, 'transfer')
        addEdge(b, a, w, 'transfer')
      }
    }
  }

  return adj
}

/** 简易二叉小顶堆 */
class MinHeap {
  constructor() { this.a = [] }
  get size() { return this.a.length }
  push(item) {
    this.a.push(item)
    let i = this.a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.a[p].d <= this.a[i].d) break
      ;[this.a[p], this.a[i]] = [this.a[i], this.a[p]]
      i = p
    }
  }
  pop() {
    const top = this.a[0]
    const last = this.a.pop()
    if (this.a.length) {
      this.a[0] = last
      let i = 0
      const n = this.a.length
      while (true) {
        const l = 2 * i + 1, r = 2 * i + 2
        let s = i
        if (l < n && this.a[l].d < this.a[s].d) s = l
        if (r < n && this.a[r].d < this.a[s].d) s = r
        if (s === i) break
        ;[this.a[s], this.a[i]] = [this.a[i], this.a[s]]
        i = s
      }
    }
    return top
  }
}

/**
 * 多源多汇 Dijkstra：起点站（任意线路）→ 终点站（任意线路）
 * @param {Map} adj
 * @param {string[]} startStationIds 起点物理站 id 列表
 * @param {Set<string>} endStationIds 终点物理站 id 集合
 * @returns {{path: Array<{stationId:string,lineId:string}>, totalSec:number}|null}
 */
export function findShortestPath(adj, startStationIds, endStationIds) {
  const endSet = new Set(endStationIds)
  const dist = new Map()
  const prev = new Map()
  const heap = new MinHeap()

  for (const sid of startStationIds) {
    // 起点站所有线路节点，距离 0
    for (const key of adj.keys()) {
      if (key.startsWith(sid + '@')) {
        dist.set(key, 0)
        heap.push({ d: 0, key })
      }
    }
  }
  if (heap.size === 0) {
    // 起点站无出边，可能是孤立站
    for (const sid of startStationIds) {
      if (endSet.has(sid)) {
        return { path: [{ stationId: sid, lineId: '' }], totalSec: 0 }
      }
    }
    return null
  }

  let endKey = null
  while (heap.size) {
    const { d, key } = heap.pop()
    if (d > (dist.get(key) ?? Infinity)) continue
    const sid = key.split('@')[0]
    if (endSet.has(sid)) {
      endKey = key
      break
    }
    const neighbors = adj.get(key)
    if (!neighbors) continue
    for (const e of neighbors) {
      const nd = d + e.weight
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd)
        prev.set(e.to, { from: key, type: e.type })
        heap.push({ d: nd, key: e.to })
      }
    }
  }

  if (!endKey) return null

  // 回溯
  const path = []
  let cur = endKey
  while (cur) {
    const [stationId, lineId] = cur.split('@')
    path.unshift({ stationId, lineId })
    const p = prev.get(cur)
    cur = p ? p.from : null
  }
  return { path, totalSec: dist.get(endKey) }
}

/**
 * 将节点路径转换为「乘车段(legs)」以便展示
 * @param {Array<{stationId:string,lineId:string}>} path
 * @returns {Array<{lineId:string, stops:string[]}>}
 */
export function pathToLegs(path) {
  if (!path || !path.length) return []
  const legs = []
  let cur = { lineId: path[0].lineId, stops: [path[0].stationId] }
  for (let i = 1; i < path.length; i++) {
    const node = path[i]
    if (node.lineId === cur.lineId && cur.lineId !== '') {
      if (cur.stops[cur.stops.length - 1] !== node.stationId) cur.stops.push(node.stationId)
    } else {
      legs.push(cur)
      cur = { lineId: node.lineId, stops: [node.stationId] }
    }
  }
  legs.push(cur)
  return legs
}

/**
 * 规划并整理结果
 * @param {object} cityData
 * @param {string} startStationId
 * @param {string} endStationId
 * @returns {object|null} { totalSec, legs, transferCount, stationCount }
 */
export function planRoute(cityData, startStationId, endStationId) {
  const adj = buildGraph(cityData)
  const result = findShortestPath(adj, [startStationId], new Set([endStationId]))
  if (!result) return null
  const legs = pathToLegs(result.path)
  const transferCount = Math.max(0, legs.length - 1)
  const stationCount = result.path.filter((n, i, arr) =>
    i === 0 || n.stationId !== arr[i - 1].stationId).length
  return {
    totalSec: result.totalSec,
    legs,
    transferCount,
    stationCount
  }
}
