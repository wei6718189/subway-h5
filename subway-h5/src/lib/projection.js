// 经纬度 → SVG 虚拟坐标投影
// 采用 bounds 内线性映射 + 纬度方向 1/cos(lat) 矫正，保证线路走向不变形

/**
 * @typedef {Object} Bounds
 * @property {number} minLng
 * @property {number} maxLng
 * @property {number} minLat
 * @property {number} maxLat
 */

/**
 * 计算城市数据的真实 bounds（若数据未提供则从站点推导）
 * @param {Object} cityData
 * @returns {Bounds}
 */
export function computeBounds(cityData) {
  if (cityData.bounds) return cityData.bounds
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const s of Object.values(cityData.stations || {})) {
    if (s.lng == null || s.lat == null) continue
    minLng = Math.min(minLng, s.lng)
    maxLng = Math.max(maxLng, s.lng)
    minLat = Math.min(minLat, s.lat)
    maxLat = Math.max(maxLat, s.lat)
  }
  // 留 5% 边距
  const padLng = (maxLng - minLng) * 0.05 || 0.01
  const padLat = (maxLat - minLat) * 0.05 || 0.01
  return { minLng: minLng - padLng, maxLng: maxLng + padLng, minLat: minLat - padLat, maxLat: maxLat + padLat }
}

/**
 * 创建投影函数：lng/lat → {x, y}（虚拟坐标空间，y 已翻转，北朝上）
 * @param {Bounds} bounds
 * @param {number} [baseWidth=1000] 输出虚拟宽度
 * @returns {{project:(lng:number,lat:number)=>{x:number,y:number}, width:number, height:number}}
 */
export function makeProjection(bounds, baseWidth = 1000) {
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
    project(lng, lat) {
      return {
        x: (lng - minLng) * scale,
        y: (maxLat - lat) * scale * latCorrection // y 翻转，北朝上
      }
    }
  }
}
