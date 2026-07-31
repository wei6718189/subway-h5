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
    <!-- 搜索补全下拉（只显示当前 active 输入框的下拉） -->
    <Teleport to="body">
      <div
        v-if="active === 'start' && startResults.length"
        class="datalist"
        :style="startDropdownStyle"
      >
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
      <div
        v-if="active === 'end' && endResults.length"
        class="datalist"
        :style="endDropdownStyle"
      >
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
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
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

const startDropdownStyle = ref({})
const endDropdownStyle = ref({})

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

function updateDropdownPos() {
  nextTick(() => {
    const startEl = startInputRef.value
    const endEl = endInputRef.value
    if (startEl) {
      const r = startEl.getBoundingClientRect()
      startDropdownStyle.value = {
        position: 'fixed',
        left: r.left + 'px',
        top: (r.bottom + 4) + 'px',
        minWidth: r.width + 'px',
        zIndex: 1000
      }
    }
    if (endEl) {
      const r = endEl.getBoundingClientRect()
      endDropdownStyle.value = {
        position: 'fixed',
        left: r.left + 'px',
        top: (r.bottom + 4) + 'px',
        minWidth: r.width + 'px',
        zIndex: 1000
      }
    }
  })
}

function onInput(which) {
  const q = which === 'start' ? startQuery.value : endQuery.value
  // 搜索结果数量加大到 20
  const results = searchStations(props.cityData, q, 20)
  if (which === 'start') startResults.value = results
  else endResults.value = results
  updateDropdownPos()
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
    updateDropdownPos()
    return
  }
  if (active.value === 'start') {
    startResults.value = searchStations(props.cityData, startQuery.value, 20)
  } else {
    endResults.value = searchStations(props.cityData, endQuery.value, 20)
  }
  updateDropdownPos()
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

defineExpose({ setStationFromMap, setStart, setEnd, reset, onClear, updateDropdownPos })
</script>

<style scoped>
.search-container {
  position: relative;
  width: 100%;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.search-row .input {
  flex: 1;
  min-width: 0;
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
</style>

<style>
/* 下拉框细节样式（Teleport 到 body，不能 scoped）
   滚动和 max-height 在全局 style.css 中统一设置，避免重复 */
.datalist {
  background: #1e2229;
  border: 1px solid #3a3f4b;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  color: #fff;
  font-size: 13px;
}
.datalist .item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.datalist .item:hover {
  background: #2a303c;
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
