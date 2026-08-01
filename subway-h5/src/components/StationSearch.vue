<template>
  <div class="search-container" ref="containerRef">
    <div class="search-row">
      <input
        class="input"
        :placeholder="startLabel"
        v-model="startQuery"
        @input="onInput('start')"
        @focus="active = 'start'"
        ref="startInputRef"
      />
      <button class="btn ghost swap-btn" @click="swap" title="交换起终点">⇄</button>
      <input
        class="input"
        :placeholder="endLabel"
        v-model="endQuery"
        @input="onInput('end')"
        @focus="active = 'end'"
        ref="endInputRef"
      />
      <button class="btn plan-btn" :disabled="!canPlan" @click="$emit('plan')">规划</button>
      <button class="btn clear-btn" :disabled="!hasRoute" @click="onClear" title="清除">清除</button>
    </div>
    <!-- 搜索补全下拉：直接定位在输入框下方，类似原生下拉框 -->
    <div v-if="active === 'start' && startResults.length" class="datalist">
      <div
        class="item"
        v-for="r in startResults"
        :key="r.id"
        @click="pick('start', r)"
      >
        <span class="station-name">{{ r.name }}</span>
        <span class="badges">
          <span
            v-for="ln in r.lines"
            :key="ln"
            class="line-badge"
            :style="lineStyle(ln)"
          >{{ shortLineName(ln) }}</span>
        </span>
      </div>
    </div>
    <div v-if="active === 'end' && endResults.length" class="datalist">
      <div
        class="item"
        v-for="r in endResults"
        :key="r.id"
        @click="pick('end', r)"
      >
        <span class="station-name">{{ r.name }}</span>
        <span class="badges">
          <span
            v-for="ln in r.lines"
            :key="ln"
            class="line-badge"
            :style="lineStyle(ln)"
          >{{ shortLineName(ln) }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { searchStations } from '../lib/loadData.js'

const props = defineProps({
  cityData: { type: Object, default: null },
  startId: { type: String, default: '' },
  endId: { type: String, default: '' }
})
const emit = defineEmits(['update:startId', 'update:endId', 'plan', 'clear', 'select-station'])

const startQuery = ref('')
const endQuery = ref('')
const active = ref('start')
const startResults = ref([])
const endResults = ref([])
const containerRef = ref(null)
const startInputRef = ref(null)
const endInputRef = ref(null)
let skipNextWatch = false

const hasRoute = computed(() => !!(props.startId || props.endId))

const startLabel = computed(() => props.startId ? stationName(props.startId) : '起点站')
const endLabel = computed(() => props.endId ? stationName(props.endId) : '终点站')
const canPlan = computed(() => !!props.startId && !!props.endId && props.startId !== props.endId)

function stationName(id) {
  return props.cityData?.stations?.[id]?.name || ''
}

function lineStyle(lineId) {
  const line = props.cityData?.lines?.find(l => l.id === lineId)
  return { background: line?.color || '#666' }
}

function shortLineName(lineId) {
  const line = props.cityData?.lines?.find(l => l.id === lineId)
  const name = line?.name || `${lineId}号线`
  const m = name.match(/(\d+[^线]*线)/)
  if (m) return m[1]
  const m2 = name.match(/(\d+号线)/)
  if (m2) return m2[1]
  return name.split('/')[0].trim()
}

function onInput(which) {
  const q = which === 'start' ? startQuery.value : endQuery.value
  // 输入为空时不显示搜索提示
  if (!q || !q.trim()) {
    if (which === 'start') startResults.value = []
    else endResults.value = []
    return
  }
  const results = searchStations(props.cityData, q, 20)
  if (which === 'start') startResults.value = results
  else endResults.value = results
}

function pick(which, r) {
  if (which === 'start') {
    skipNextWatch = true
    emit('update:startId', r.id)
    startQuery.value = r.name
    startResults.value = []
    active.value = 'start'
  } else {
    skipNextWatch = true
    emit('update:endId', r.id)
    endQuery.value = r.name
    endResults.value = []
  }
}

function swap() {
  skipNextWatch = true
  const sId = props.startId
  emit('update:startId', props.endId)
  emit('update:endId', sId)
  startQuery.value = stationName(props.endId)
  endQuery.value = stationName(sId)
  active.value = 'start'
}

function onClear() {
  skipNextWatch = true
  startQuery.value = ''
  endQuery.value = ''
  startResults.value = []
  endResults.value = []
  emit('update:startId', '')
  emit('update:endId', '')
  emit('clear')
  active.value = 'start'
}

watch([startQuery, endQuery, active, () => props.cityData], () => {
  if (skipNextWatch) {
    skipNextWatch = false
    return
  }
  // 输入为空时不显示搜索提示弹窗
  if (active.value === 'start') {
    startResults.value = startQuery.value && startQuery.value.trim()
      ? searchStations(props.cityData, startQuery.value, 20)
      : []
  } else {
    endResults.value = endQuery.value && endQuery.value.trim()
      ? searchStations(props.cityData, endQuery.value, 20)
      : []
  }
}, { flush: 'nextTick' })

watch(() => props.cityData, () => {
  startQuery.value = ''
  endQuery.value = ''
  startResults.value = []
  endResults.value = []
  emit('update:startId', '')
  emit('update:endId', '')
  active.value = 'start'
})

// 暴露给父组件
function setStationFromMap(id) {
  emit('select-station', id)
}
function setStart(id) {
  const st = props.cityData?.stations?.[id]
  if (!st) return
  skipNextWatch = true
  emit('update:startId', id)
  startQuery.value = st.name
  startResults.value = []
  active.value = 'start'
}
function setEnd(id) {
  const st = props.cityData?.stations?.[id]
  if (!st) return
  skipNextWatch = true
  emit('update:endId', id)
  endQuery.value = st.name
  endResults.value = []
}
function reset() {
  skipNextWatch = true
  startQuery.value = ''
  endQuery.value = ''
  startResults.value = []
  endResults.value = []
  emit('update:startId', '')
  emit('update:endId', '')
  active.value = 'start'
}

defineExpose({ setStationFromMap, setStart, setEnd, reset, onClear })
</script>

<style scoped>
.search-container {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: visible;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  flex-wrap: nowrap;
  min-width: 0;
  max-width: 100%;
}
.search-row .input {
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  height: 30px;
  box-sizing: border-box;
}
.swap-btn {
  width: 26px;
  height: 30px;
  flex-shrink: 0;
  padding: 0;
  font-size: 12px;
}
.plan-btn {
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 12px;
  height: 30px;
}
.clear-btn {
  flex-shrink: 0;
  padding: 6px 8px;
  font-size: 12px;
  height: 30px;
}
/* 下拉框：绝对定位在搜索行正下方，类似原生下拉 */
.datalist {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 2px;
  max-height: 220px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: #ffffff;
  border: 1px solid #e0e3e8;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  z-index: 50;
}
.datalist .item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
  color: #1a1d24;
  font-size: 13px;
}
.datalist .item:hover {
  background: #f0f2f5;
}
.datalist .station-name {
  flex-shrink: 0;
  font-size: 13px;
}
.datalist .badges {
  display: inline-flex;
  gap: 3px;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.datalist .line-badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  color: #fff;
  white-space: nowrap;
  line-height: 14px;
  min-width: unset;
  height: 16px;
}
</style>
