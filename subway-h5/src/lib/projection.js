// 坐标 → SVG 虚拟坐标投影
// 支持两种坐标类型：
//   1. schematic（示意图坐标，高德地铁图）：站点有 x/y 字段，直接线性映射
//   2. geographic（真实经纬度，OSM 数据）：站点有 lng/lat 字段，做经纬度投影

/**
 * 计算城市数据的 bounds（自动检测坐标类型）
 */
export function computeBounds(cityData) {
  if (cityData.bounds && cityData.bounds.minX != null) {
    return { ...cityData.bounds, type: 'schematic' }
  }
  if (cityData.bounds && cityData.bounds.minLng != null) {
    return { ...cityData.bounds, type: 'geographic' }
  }
  // 从站点推导
  const stations = Object.values(cityData.stations || {})
  const hasXY = stations.some(s => s.x != null && s.y != null)
  if (hasXY) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const s of stations) {
      if (s.x == null || s.y == null) continue
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x)
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y)
    }
    const padX = (maxX - minX) * 0.05 || 10
    const padY = (maxY - minY) * 0.05 || 10
    return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY, type: 'schematic' }
  }
  // 经纬度
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const s of stations) {
    if (s.lng == null || s.lat == null) continue
    minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng)
    minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat)
  }
  const padLng = (maxLng - minLng) * 0.05 || 0.01
  const padLat = (maxLat - minLat) * 0.05 || 0.01
  return { minLng: minLng - padLng, maxLng: maxLng + padLng, minLat: minLat - padLat, maxLat: maxLat + padLat, type: 'geographic' }
}

/**
 * 创建投影函数
 * - 示意图坐标：x/y → {x, y}（简单线性映射，y 翻转让北朝上）
 * - 经纬度：lng/lat → {x, y}（含纬度矫正）
 */
export function makeProjection(bounds, baseWidth = 1000) {
  if (bounds.type === 'schematic' || bounds.minX != null) {
    // 示意图坐标模式
    const { minX, maxX, minY, maxY } = bounds
    const xRange = Math.max(maxX - minX, 1e-6)
    const yRange = Math.max(maxY - minY, 1e-6)
    const scale = baseWidth / xRange
    const width = baseWidth
    const height = yRange * scale
    return {
      width,
      height,
      projectXY(x, y) {
        return {
          x: (x - minX) * scale,
          y: (y - minY) * scale // 不翻转：高德数据已按上北下南布局
        }
      },
      // 兼容旧接口：把站点坐标投影
      projectStation(s) {
        return this.projectXY(s.x, s.y)
      }
    }
  }

  // 经纬度模式（兼容旧数据）
  const { minLng, maxLng, minLat, maxLat } = bounds
  const lngRange = Math.max(maxLng - minLng, 1e-6)
  const latRange = Math.max(maxLat - minLat, 1e-6)
  const midLat = (minLat + maxLat) / 2
  const latCorrection = 1 / Math.cos((midLat * Math.PI) / 180)
  const correctedLatRange = latRange * latCorrection
  const scale = baseWidth / lngRange
  const width = baseWidth
  const height = correctedLatRange * scale
  return {
    width,
    height,
    projectXY(_x, _y) {
      throw new Error('经纬度模式请使用 project(lng, lat)')
    },
    projectStation(s) {
      return {
        x: (s.lng - minLng) * scale,
        y: (maxLat - s.lat) * scale * latCorrection
      }
    },
    project(lng, lat) {
      return {
        x: (lng - minLng) * scale,
        y: (maxLat - lat) * scale * latCorrection
      }
    }
  }
}
