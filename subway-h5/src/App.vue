<template>
  <div class="app">
    <div class="topbar">
      <h1 v-show="false">地铁线路图</h1>
      <div class="provider-select" ref="providerRef" v-show="false">
        <div class="provider-toggle" @click.stop="toggleProvider">
          <span>{{ currentProviderName }}</span>
          <span class="provider-arrow">{{ providerOpen ? '▼' : '▶' }}</span>
        </div>
        <div class="provider-body" v-if="providerOpen">
          <div
            v-for="p in visibleProviders"
            :key="p.id"
            class="provider-item"
            :class="{ active: currentProvider === p.id }"
            @click.stop="onProviderChange(p.id)"
          >
            {{ p.name }}
          </div>
        </div>
      </div>
      <CitySwitcher :current="currentCity" @update:current="onCityChange" />
      <!-- 线路图例 -->
      <div class="legend" v-if="cityData" ref="legendRef">
        <div class="legend-toggle" @click.stop="toggleLegend">
          <span>线路图例</span>
          <span class="legend-arrow">{{ legendOpen ? '▼' : '▶' }}</span>
        </div>
        <div class="legend-body" v-if="legendOpen">
          <div
            class="lg-item"
            v-for="line in cityData.lines"
            :key="'lg-' + line.id"
            :class="{ active: highlightLineId === line.id }"
            @click.stop="onLegendClickLine(line.id)"
          >
            <span class="lg-swatch" :style="{ background: line.color }"></span>
            <span>{{ line.name }}</span>
          </div>
        </div>
      </div>
      <!-- 更多菜单 -->
      <div class="more-select" ref="moreRef">
        <div class="more-toggle" @click.stop="toggleMore">
          <span>更多</span>
          <span class="more-arrow">{{ moreOpen ? '▼' : '▶' }}</span>
        </div>
        <div class="more-body" v-if="moreOpen">
          <div class="more-item" v-if="currentCity === 'shenzhen'" @click.stop="openOfficialMap">官方地铁图</div>
          <div class="more-item" @click.stop="showAbout">关于</div>
          <div class="more-item" @click.stop="showHelp">说明</div>
        </div>
      </div>
    </div>

    <!-- 官方地铁图查看器 -->
    <OfficialMapViewer
      :visible="officialMapOpen"
      :url="officialMapUrl"
      @close="officialMapOpen = false"
    />

    <div class="notice" v-if="notice">{{ notice }}</div>

    <SubwayMap
      ref="mapRef"
      :city-data="cityData"
      :highlight="highlightLegs"
      :start-id="startId"
      :end-id="endId"
      :loading="loading"
      :highlight-line-id="highlightLineId"
      @select-station="onMapSelectStation"
    />

    <!-- 站点选择弹窗：出现在站点上方/下方 -->
    <Teleport to="body">
      <div
        v-if="popupStation"
        class="station-popup"
        :class="popupPlacement"
        :style="popupPosStyle"
        @click.stop
      >
        <div class="popup-title" @click="copyStationName" title="点击复制站名">{{ popupStation.name }}</div>
        <div class="popup-copy-tip" v-if="copied">已复制到剪贴板 ✓</div>
        <div class="popup-lines">
          <span
            v-for="ln in popupStation.lines"
            :key="ln"
            class="line-badge"
            :style="{ background: lineColor(ln) }"
          >{{ shortLineName(ln) }}</span>
        </div>
        <div class="popup-actions">
          <button class="btn start-btn" @click="setAsStart">设为起点</button>
          <button class="btn end-btn" @click="setAsEnd">设为终点</button>
          <button
            v-if="isSelected(popupStationId)"
            class="btn ghost cancel-btn"
            @click="deselectStation"
          >取消选择</button>
        </div>
        <!-- 小箭头：指向站点 -->
        <div class="popup-arrow" :class="popupPlacement"></div>
      </div>
    </Teleport>

    <div
      class="bottom-panel"
      :class="drawerExpanded ? 'expanded' : 'collapsed'"
      :style="drawerStyle"
      ref="panelRef"
    >
      <div
        class="drawer-handle"
        @click="toggleDrawer"
        @touchstart="onHandleTouchStart"
        @touchmove.prevent="onHandleTouchMove"
        @touchend="onHandleTouchEnd"
      >
        <div class="drawer-bar"></div>
        <div v-if="!drawerExpanded && fastestSummary" class="drawer-peek-text">{{ fastestSummary }}</div>
      </div>

      <StationSearch
        ref="searchRef"
        :city-data="cityData"
        v-model:startId="startId"
        v-model:endId="endId"
        @plan="onPlan"
        @clear="onClearRoute"
        @select-station="onPopupSelect"
      />
      <div class="route-scroll-container">
        <RouteResult
          :routes="routePlans"
          :active-key="activeKey"
          :city-data="cityData"
          @select="onSelectPlan"
          @clear="onClearRoute"
        />
      </div>
    </div>

    <!-- PWA 更新提示横幅：发现新版本时显示，点击立即更新 -->
    <div class="pwa-update-banner" v-if="showUpdate" @click="doUpdate">
      <span class="pwa-update-text">发现新版本，点击更新</span>
      <span class="pwa-update-btn">更新</span>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from 'vue'
import SubwayMap from './components/SubwayMap.vue'
import StationSearch from './components/StationSearch.vue'
import RouteResult from './components/RouteResult.vue'
import CitySwitcher from './components/CitySwitcher.vue'
import OfficialMapViewer from './components/OfficialMapViewer.vue'
import { loadCity, PROVIDERS, BAIDU_CITIES, CITIES } from './lib/loadData.js'
import { planRoute } from './lib/graph.js'
import { registerSW } from 'virtual:pwa-register'

const currentCity = ref('shenzhen')
const currentProvider = ref('baidu')
const drawerExpanded = ref(true)
const panelRef = ref(null)
const dragY = ref(0)

// iOS 已安装 PWA（standalone）不会自动应用 waiting 中的新 SW，也不会主动检查更新；
// 需要我们在「启动 / 从后台回到前台」时主动触发更新检查。
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
const isStandalone =
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches
const isIOSStandalone = isIOS && isStandalone

// PWA 更新提示：发现新版本时弹出横幅，点击触发 SW 激活并刷新
const showUpdate = ref(false)
const updateSW = registerSW({
  onNeedRefresh() {
    if (isIOSStandalone) {
      // iOS 台标 PWA 直接自动激活并刷新，避免依赖用户手动点横幅（iOS 不会自动应用 waiting SW）
      updateSW()
    } else {
      showUpdate.value = true
    }
  },
  onOfflineReady() {
    // 应用已可离线使用，这里暂不需要提示
  }
})
function doUpdate() {
  showUpdate.value = false
  // true = 立即激活 waiting 中的新 SW 并 reload
  updateSW(true)
}

// iOS standalone：在启动及从后台切回前台时主动拉取新 SW（iOS 自身不主动检查更新）
if (isIOSStandalone) {
  const checkUpdate = () => updateSW()
  // iOS 把 PWA 切到后台再切回前台会触发 pageshow（persisted=true），这是最可靠的更新时机
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) checkUpdate()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkUpdate()
  })
  // 初次进入也检查一次，确保 SW 注册完成后触发更新检测
  setTimeout(checkUpdate, 1500)
}
let drawerStartY = 0
let drawerPanelH = 0
const providers = PROVIDERS
// 隐藏「百度（真实坐标地理位置）」选项，后期需要时可移除此过滤
const visibleProviders = computed(() => providers.filter(p => p.id !== 'baidu-geo'))
const currentProviderName = computed(() => visibleProviders.value.find(p => p.id === currentProvider.value)?.name || '')
const drawerStyle = computed(() => {
  if (!drawerExpanded.value || dragY.value <= 0) return {}
  return { transform: `translateY(${dragY.value}px)` }
})
const fastestSummary = computed(() => {
  const plan = route.value?.fastest
  if (!plan) return ''
  const mins = Math.round((plan.totalSec || 0) / 60)
  const stops = plan.stationCount || 0
  const transfers = plan.transferCount || 0
  return `${mins}分 · ${stops}站 · 换乘${transfers}次`
})
const providerRef = ref(null)
const providerOpen = ref(false)
const notice = ref('')
const cityData = shallowRef(null)
const loading = ref(false)
const startId = ref('')
const endId = ref('')
const route = ref(null)
const activeKey = ref('fastest')

// 当前选中方案的乘车段，用于地图高亮
const highlightLegs = computed(() => {
  if (!route.value) return []
  const plan = activeKey.value === 'leastTransfer' ? route.value.leastTransfer : route.value.fastest
  return plan ? plan.legs : []
})

// 组装展示方案列表；若最少换乘与最快路线完全一致，则只展示最快
const routePlans = computed(() => {
  if (!route.value) return []
  const plans = [{ key: 'fastest', label: '最快路线', route: route.value.fastest }]
  const l = route.value.leastTransfer
  if (l && !samePlan(route.value.fastest, l)) {
    plans.push({ key: 'leastTransfer', label: '最少换乘', route: l })
  }
  return plans
})

function samePlan(a, b) {
  if (!a || !b) return false
  if (a.transferCount !== b.transferCount) return false
  const seq = legs => legs.flatMap(leg => leg.stops).join('>')
  return seq(a.legs) === seq(b.legs)
}

const mapRef = ref(null)
const searchRef = ref(null)

// 图例状态
const legendRef = ref(null)
const legendOpen = ref(false)
const highlightLineId = ref('')

function toggleLegend() {
  legendOpen.value = !legendOpen.value
}

function onLegendClickLine(lineId) {
  if (highlightLineId.value === lineId) {
    highlightLineId.value = ''
  } else {
    highlightLineId.value = lineId
  }
}

// 数据源下拉
function toggleProvider() {
  providerOpen.value = !providerOpen.value
}

function onDocClickProvider(e) {
  if (!providerRef.value) return
  if (providerRef.value.contains(e.target)) return
  providerOpen.value = false
}

// 更多菜单
const moreRef = ref(null)
const moreOpen = ref(false)

// 官方地铁图查看器
const officialMapOpen = ref(false)
// 深圳地铁官方线路图（深圳地铁官网高清图）
const officialMapUrl = 'https://www.szmc.net/SMARTC/upload/image/20260630/1782803829923076269.png'

function openOfficialMap() {
  moreOpen.value = false
  officialMapOpen.value = true
}

function toggleMore() {
  moreOpen.value = !moreOpen.value
}

function onDocClickMore(e) {
  if (!moreRef.value) return
  if (moreRef.value.contains(e.target)) return
  moreOpen.value = false
}

function showAbout() {
  moreOpen.value = false
  alert('地铁线路图 H5\n\n一个基于高德/百度地图数据的城市地铁线路查询工具。\n支持深圳、广州、南宁等城市。')
}

function showHelp() {
  moreOpen.value = false
  alert('使用说明\n\n1. 点击地图上的站点可查看详情、设为起点/终点\n2. 在底部搜索框输入站名可快速规划路线\n3. 点击「线路图例」可高亮某条线路\n4. 支持最快路线与最少换乘两种方案')
}

// 点击图例下拉框以外：
// 1) 下拉框打开时 → 仅收起，保留高亮
// 2) 下拉框已收起且有高亮 → 清除高亮
function onDocClickLegend(e) {
  if (!legendRef.value) return
  if (legendRef.value.contains(e.target)) return
  if (legendOpen.value) {
    legendOpen.value = false
  } else if (highlightLineId.value) {
    highlightLineId.value = ''
  }
}

// 弹窗状态
const popupStationId = ref('')
const popupPosStyle = ref({})
const popupPlacement = ref('bottom') // 'top' or 'bottom'
const popupStation = ref(null)
const copied = ref(false)
let copyTimer = null

async function copyStationName() {
  const name = popupStation.value?.name
  if (!name) return
  let ok = false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(name)
      ok = true
    }
  } catch (e) { /* 落到降级方案 */ }
  if (!ok) {
    // 降级：临时 textarea + execCommand（兼容非安全上下文 / 旧浏览器）
    try {
      const ta = document.createElement('textarea')
      ta.value = name
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch (e) { ok = false }
  }
  copied.value = ok
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1500)
}

function lineColor(lineId) {
  return cityData.value?.lines?.find(l => l.id === lineId)?.color || '#666'
}

function shortLineName(lineId) {
  const name = cityData.value?.lines?.find(l => l.id === lineId)?.name || `${lineId}号线`
  const m = name.match(/(\d+[^线]*线)/)
  if (m) return m[1]
  const m2 = name.match(/(\d+号线)/)
  if (m2) return m2[1]
  return name.split('/')[0].trim()
}

function isSelected(id) {
  return startId.value === id || endId.value === id
}

function closePopup() {
  popupStationId.value = ''
  popupStation.value = null
}

// 点击外部关闭弹窗
function onGlobalClick(e) {
  if (!popupStation.value) return
  const popupEl = document.querySelector('.station-popup')
  if (popupEl && popupEl.contains(e.target)) return
  // 也不关闭如果点击的是地图上的站点 circle（会由 onMapSelectStation 处理）
  if (e.target && e.target.closest && e.target.closest('svg.map circle')) return
  closePopup()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick, true)
  document.addEventListener('click', onDocClickLegend, true)
  document.addEventListener('click', onDocClickProvider, true)
  document.addEventListener('click', onDocClickMore, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onGlobalClick, true)
  document.removeEventListener('click', onDocClickLegend, true)
  document.removeEventListener('click', onDocClickProvider, true)
  document.removeEventListener('click', onDocClickMore, true)
})

function setAsStart() {
  searchRef.value?.setStart(popupStationId.value)
  closePopup()
}

function setAsEnd() {
  searchRef.value?.setEnd(popupStationId.value)
  closePopup()
  if (startId.value && endId.value && startId.value !== endId.value) {
    onPlan()
  }
}

function deselectStation() {
  if (startId.value === popupStationId.value) {
    startId.value = ''
  } else if (endId.value === popupStationId.value) {
    endId.value = ''
  }
  route.value = null
  closePopup()
}

function cityName(id) {
  return CITIES.find(c => c.id === id)?.name || id
}

// 按当前「城市 + 数据源」加载数据；百度无该城市数据时回退高德并提示
async function loadCurrent() {
  const cityId = currentCity.value
  const provider = currentProvider.value
  loading.value = true
  closePopup()
  try {
    cityData.value = await loadCity(cityId, provider)
    notice.value = ''
  } catch (e) {
    console.error(e)
    if ((provider === 'baidu' || provider === 'baidu-geo') && !BAIDU_CITIES.includes(cityId)) {
      notice.value = `百度地图暂未提供「${cityName(cityId)}」地铁数据，已切换回高德（示意图）`
      currentProvider.value = 'amap'
      cityData.value = await loadCity(cityId, 'amap')
    } else {
      cityData.value = null
      alert(`加载 ${cityId} 数据失败：${e.message}\n请先运行 npm run prepare:${provider}:${cityId}`)
    }
  } finally {
    loading.value = false
  }
}

async function onCityChange(cityId) {
  if (cityId === currentCity.value && cityData.value) return
  currentCity.value = cityId
  route.value = null
  startId.value = ''
  endId.value = ''
  await loadCurrent()
}

async function onProviderChange(p) {
  providerOpen.value = false
  if (p === currentProvider.value) return
  currentProvider.value = p
  route.value = null
  startId.value = ''
  endId.value = ''
  await loadCurrent()
}

function onMapSelectStation(id, screenX, screenY) {
  const st = cityData.value?.stations?.[id]
  if (!st) return

  // 如果点击的是已选站点 → 取消选择
  if (startId.value === id || endId.value === id) {
    if (startId.value === id) startId.value = ''
    else endId.value = ''
    route.value = null
    closePopup()
    return
  }

  // 显示弹窗：出现在站点上方或下方
  popupStationId.value = id
  popupStation.value = st
  const px = screenX != null ? screenX : window.innerWidth / 2
  const py = screenY != null ? screenY : window.innerHeight / 2

  const popupW = 180
  const popupH = 190
  const gap = 14  // 与站点的间距
  const arrowH = 8

  // 优先放在站点下方；如果下方空间不够，就放上方
  const bottomSpace = window.innerHeight - py
  const topSpace = py
  let top, left
  if (bottomSpace > popupH + gap + 60) {
    // 放下方
    popupPlacement.value = 'bottom'
    top = py + gap + 10
  } else if (topSpace > popupH + gap + 10) {
    // 放上方
    popupPlacement.value = 'top'
    top = py - popupH - gap - 10
  } else {
    // 空间都不够，放到屏幕中
    popupPlacement.value = 'bottom'
    top = Math.min(py + gap, window.innerHeight - popupH - 20)
  }

  // 水平居中于站点，避免超出屏幕
  left = px - popupW / 2
  if (left < 10) left = 10
  if (left + popupW > window.innerWidth - 10) left = window.innerWidth - popupW - 10

  popupPosStyle.value = {
    position: 'fixed',
    left: left + 'px',
    top: top + 'px',
    width: popupW + 'px',
    zIndex: 2000
  }
}

function onPopupSelect(id) {
  // StationSearch 内部处理搜索框选站
}

function onPlan() {
  if (!cityData.value || !startId.value || !endId.value) return
  const result = planRoute(cityData.value, startId.value, endId.value)
  if (!result) {
    alert('未找到可行路径，可能两站不在连通线网内')
    return
  }
  route.value = result
  activeKey.value = 'fastest'
  drawerExpanded.value = true
  const plan = result.fastest
  const stationIds = []
  for (const leg of plan.legs) stationIds.push(...leg.stops)
  mapRef.value?.zoomToStations(stationIds)
}

function onSelectPlan(key) {
  activeKey.value = key
  if (!route.value) return
  const plan = key === 'leastTransfer' ? route.value.leastTransfer : route.value.fastest
  if (!plan) return
  const stationIds = []
  for (const leg of plan.legs) stationIds.push(...leg.stops)
  mapRef.value?.zoomToStations(stationIds)
}

function onClearRoute() {
  route.value = null
  activeKey.value = 'fastest'
  mapRef.value?.fitAll()
}

function toggleDrawer() {
  drawerExpanded.value = !drawerExpanded.value
  dragY.value = 0
}

function onHandleTouchStart(e) {
  drawerStartY = e.touches[0].clientY
  drawerPanelH = panelRef.value?.offsetHeight || 0
  dragY.value = 0
}

function onHandleTouchMove(e) {
  if (!drawerExpanded.value) return
  const dy = e.touches[0].clientY - drawerStartY
  if (dy > 0) {
    // 拖动距离不超过收起后露出的高度，避免拉过头
    const maxDy = Math.max(0, drawerPanelH - 76)
    dragY.value = Math.min(dy, maxDy)
  }
}

function onHandleTouchEnd(e) {
  const dy = e.changedTouches[0].clientY - drawerStartY
  const threshold = Math.max(40, drawerPanelH * 0.2)
  if (drawerExpanded.value && dy > threshold) {
    drawerExpanded.value = false
  }
  dragY.value = 0
}

onCityChange('shenzhen')
</script>

<style>
.station-popup {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  gap: 9px;
  animation: popIn 0.12s ease-out;
}
@keyframes popIn {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.popup-arrow {
  position: absolute;
  width: 14px;
  height: 14px;
  background: rgba(255, 255, 255, 0.72);
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  transform: rotate(45deg);
  left: 50%;
  margin-left: -7px;
}
.popup-arrow.bottom {
  top: -8px;
}
.popup-arrow.top {
  bottom: -8px;
  transform: rotate(-135deg);
  border-left: none;
  border-top: none;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.popup-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1d24;
  text-align: center;
  margin: 0;
  cursor: pointer;
  user-select: none;
}
.popup-title:active {
  opacity: 0.6;
}
.popup-copy-tip {
  font-size: 11px;
  color: #2e9e5b;
  text-align: center;
  margin-top: -4px;
}
.popup-lines {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
}
.popup-lines .line-badge {
  font-size: 10.5px;
  padding: 1.5px 5px;
  border-radius: 3px;
  color: #fff;
}
.popup-actions {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.popup-actions .btn {
  width: 100%;
  font-size: 12.5px;
  padding: 6.5px 0;
  border-radius: 7px;
  border: none;
  cursor: pointer;
}
.start-btn {
  background: #4a9eff;
  color: #fff;
}
.end-btn {
  background: #ff8c42;
  color: #fff;
}
.cancel-btn {
  background: transparent;
  color: #aaa;
  font-size: 11.5px !important;
  padding: 3px 0 !important;
}
.route-scroll-container {
  overflow-y: auto;
  max-height: calc(100vh - 300px);
  -webkit-overflow-scrolling: touch;
}
.provider-select {
  position: relative;
  flex-shrink: 0;
}
.provider-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  user-select: none;
  white-space: nowrap;
}
.provider-arrow {
  font-size: 9px;
  color: var(--text-dim);
}
.provider-body {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 160px;
  max-height: 50vh;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  padding: 4px;
  z-index: 50;
}
.provider-item {
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  font-size: 13px;
  color: var(--text);
}
.provider-item:hover {
  background: #eef0f3;
}
.provider-item.active {
  background: #e8f0fe;
  color: #1a73e8;
  font-weight: 600;
}
.notice {
  margin: 6px 10px;
  padding: 8px 12px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 8px;
  color: #ad6800;
  font-size: 13px;
}

.pwa-update-banner {
  position: fixed;
  top: calc(var(--safe-top) + 56px);
  left: 12px;
  right: 12px;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: #1a73e8;
  color: #fff;
  border-radius: 10px;
  font-size: 13px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  cursor: pointer;
  user-select: none;
  animation: popIn 0.12s ease-out;
}
.pwa-update-text {
  flex: 1;
  min-width: 0;
}
.pwa-update-btn {
  flex-shrink: 0;
  padding: 5px 14px;
  background: #fff;
  color: #1a73e8;
  border-radius: 7px;
  font-weight: 600;
  font-size: 13px;
}
</style>
