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
    <!-- 搜索补全下拉：Teleport 到 body 并 fixed 定位（脱离抽屉 overflow，且 z-index 高于抽屉），可见期间由 rAF 循环持续锚定到搜索框下方 -->
    <Teleport to="body" v-if="active === 'start' && startResults.length">
      <div ref="startListRef" class="datalist" :style="datalistStyle">
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
    </Teleport>
    <Teleport to="body" v-if="active === 'end' && endResults.length">
      <div ref="endListRef" class="datalist" :style="datalistStyle">
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
import { ref, computed, watch, Teleport, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { searchStations } from '../lib/loadData.js'

const props = defineProps({
  cityData: { type: Object, default: null },
  startId: { type: String, default: '' },
  endId: { type: String, default: '' },
  drawerExpanded: { type: Boolean, default: true }
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
const startListRef = ref(null)
const endListRef = ref(null)
const datalistStyle = ref({})
let skipNextWatch = false
let rafId = null

function updateDatalistStyle() {
  if (!containerRef.value || !active.value) {
    datalistStyle.value = {}
    return
  }
  const rect = containerRef.value.getBoundingClientRect()
  const vh = window.innerHeight
  const wantH = 220 // 期望最大高度
  const gap = 4
  const belowSpace = vh - rect.bottom - gap // 搜索框下方可用空间
  const aboveSpace = rect.top - gap // 搜索框上方可用空间
  // 下方放不下且上方更宽 → 向上翻转展开，避免抽屉收在底部时下拉被挤出屏幕
  const placeAbove = belowSpace < wantH && aboveSpace > belowSpace
  let top, bottom, maxH
  if (placeAbove) {
    maxH = Math.max(60, Math.min(wantH, aboveSpace))
    top = 'auto'
    bottom = `${vh - rect.top + gap}px`
  } else {
    maxH = Math.max(60, Math.min(wantH, belowSpace))
    top = `${rect.bottom + gap}px`
    bottom = 'auto'
  }
  datalistStyle.value = {
    position: 'fixed',
    left: `${rect.left}px`,
    top,
    bottom,
    width: `${rect.width}px`,
    maxHeight: `${maxH}px`,
    zIndex: '100',
    overflowY: 'auto'
  }
}

function scheduleUpdate() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    updateDatalistStyle()
  })
}

function onDocPointerDown(e) {
  const target = e.target
  const inside =
    containerRef.value?.contains(target) ||
    startListRef.value?.contains(target) ||
    endListRef.value?.contains(target)
  if (!inside) {
    active.value = ''
    startResults.value = []
    endResults.value = []
  }
}

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

watch([active, startResults, endResults], () => {
  nextTick(updateDatalistStyle)
}, { flush: 'post' })

// 抽屉拖拽 / 展开收起动画会让搜索框实时上下移动；下拉若是某一刻的固定坐标就会"飘"。
// 下拉可见期间用 rAF 循环持续锚定到搜索框正下方，彻底消除漂移（静止时循环已停止，无额外开销）。
const listVisible = computed(() =>
  (active.value === 'start' && startResults.value.length > 0) ||
  (active.value === 'end' && endResults.value.length > 0)
)
let followRaf = null
function followTick() {
  updateDatalistStyle()
  followRaf = requestAnimationFrame(followTick)
}
function startFollow() {
  if (followRaf == null) followRaf = requestAnimationFrame(followTick)
}
function stopFollow() {
  if (followRaf != null) {
    cancelAnimationFrame(followRaf)
    followRaf = null
  }
}
watch(listVisible, (v) => {
  if (v) {
    nextTick(() => { updateDatalistStyle(); startFollow() })
  } else {
    stopFollow()
  }
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  window.addEventListener('resize', scheduleUpdate)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleUpdate)
    window.visualViewport.addEventListener('scroll', scheduleUpdate)
  }
})

onBeforeUnmount(() => {
  stopFollow()
  document.removeEventListener('pointerdown', onDocPointerDown)
  window.removeEventListener('resize', scheduleUpdate)
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', scheduleUpdate)
    window.visualViewport.removeEventListener('scroll', scheduleUpdate)
  }
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
  margin-bottom: 16px;
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
  padding: 8px 10px;
  /* iOS: font-size 必须 ≥16px 才能避免 focus 时浏览器自动放大页面 */
  font-size: 16px;
  height: 40px;
  line-height: 24px;
  box-sizing: border-box;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
.swap-btn {
  width: 34px;
  height: 40px;
  flex-shrink: 0;
  padding: 0;
  font-size: 14px;
}
.plan-btn {
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 14px;
  height: 40px;
}
.clear-btn {
  flex-shrink: 0;
  padding: 8px 10px;
  font-size: 14px;
  height: 40px;
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
