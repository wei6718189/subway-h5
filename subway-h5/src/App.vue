<template>
  <div class="app">
    <div class="topbar">
      <h1>地铁线路图</h1>
      <CitySwitcher :current="currentCity" @update:current="onCityChange" />
    </div>

    <SubwayMap
      ref="mapRef"
      :city-data="cityData"
      :highlight="route ? route.legs : []"
      :start-id="startId"
      :end-id="endId"
      :loading="loading"
      @select-station="onMapSelectStation"
    />

    <div class="bottom-panel">
      <StationSearch
        ref="searchRef"
        :city-data="cityData"
        v-model:startId="startId"
        v-model:endId="endId"
        @plan="onPlan"
      />
      <div style="margin-top:10px">
        <RouteResult :route="route" :city-data="cityData" @clear="onClearRoute" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef } from 'vue'
import SubwayMap from './components/SubwayMap.vue'
import StationSearch from './components/StationSearch.vue'
import RouteResult from './components/RouteResult.vue'
import CitySwitcher from './components/CitySwitcher.vue'
import { loadCity } from './lib/loadData.js'
import { planRoute } from './lib/graph.js'

const currentCity = ref('shenzhen')
const cityData = shallowRef(null)
const loading = ref(false)
const startId = ref('')
const endId = ref('')
const route = ref(null)

const mapRef = ref(null)
const searchRef = ref(null)

async function onCityChange(cityId) {
  if (cityId === currentCity.value && cityData.value) return
  currentCity.value = cityId
  route.value = null
  startId.value = ''
  endId.value = ''
  loading.value = true
  try {
    cityData.value = await loadCity(cityId)
  } catch (e) {
    console.error(e)
    cityData.value = null
    alert(`加载 ${cityId} 数据失败：${e.message}\n请先运行 npm run prepare:data:${cityId}`)
  } finally {
    loading.value = false
  }
}

function onMapSelectStation(id) {
  searchRef.value?.setStationFromMap(id)
}

function onPlan() {
  if (!cityData.value || !startId.value || !endId.value) return
  const result = planRoute(cityData.value, startId.value, endId.value)
  if (!result) {
    alert('未找到可行路径，可能两站不在连通线网内')
    return
  }
  route.value = result
  // 缩放到路径范围
  const stationIds = []
  for (const leg of result.legs) stationIds.push(...leg.stops)
  mapRef.value?.zoomToStations(stationIds)
}

function onClearRoute() {
  route.value = null
}

// 初始化加载默认城市
onCityChange('shenzhen')
</script>
