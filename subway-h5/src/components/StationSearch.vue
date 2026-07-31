<template>
  <div>
    <div class="row">
      <input
        class="input"
        :placeholder="startLabel"
        v-model="startQuery"
        @input="onInput('start')"
        @focus="active = 'start'"
      />
      <button class="btn ghost" @click="swap" title="交换起终点">⇄</button>
    </div>
    <div class="datalist" v-if="active === 'start' && startResults.length">
      <div
        class="item"
        v-for="r in startResults"
        :key="r.id"
        @click="pick('start', r)"
      >
        <span>{{ r.name }}</span>
        <span v-for="ln in r.lines" :key="ln" class="line-badge" :style="lineStyle(ln)">{{ ln }}</span>
      </div>
    </div>

    <div class="row" style="margin-top:8px">
      <input
        class="input"
        :placeholder="endLabel"
        v-model="endQuery"
        @input="onInput('end')"
        @focus="active = 'end'"
      />
      <button class="btn" :disabled="!canPlan" @click="$emit('plan')">规划</button>
    </div>
    <div class="datalist" v-if="active === 'end' && endResults.length">
      <div
        class="item"
        v-for="r in endResults"
        :key="r.id"
        @click="pick('end', r)"
      >
        <span>{{ r.name }}</span>
        <span v-for="ln in r.lines" :key="ln" class="line-badge" :style="lineStyle(ln)">{{ ln }}</span>
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
const emit = defineEmits(['update:startId', 'update:endId', 'plan'])

const startQuery = ref('')
const endQuery = ref('')
const active = ref('start')
const startResults = ref([])
const endResults = ref([])

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

function onInput(which) {
  const q = which === 'start' ? startQuery.value : endQuery.value
  const results = searchStations(props.cityData, q, 12)
  if (which === 'start') startResults.value = results
  else endResults.value = results
}

function pick(which, r) {
  if (which === 'start') {
    emit('update:startId', r.id)
    startQuery.value = r.name
    startResults.value = []
    active.value = 'end'
  } else {
    emit('update:endId', r.id)
    endQuery.value = r.name
    endResults.value = []
  }
}

function swap() {
  const sId = props.startId
  emit('update:startId', props.endId)
  emit('update:endId', sId)
  startQuery.value = stationName(props.endId)
  endQuery.value = stationName(sId)
}

// 当查询变化时实时搜索（双保险 @input）
watch([startQuery, endQuery, () => props.cityData], () => {
  if (active.value === 'start') {
    startResults.value = searchStations(props.cityData, startQuery.value, 12)
  } else {
    endResults.value = searchStations(props.cityData, endQuery.value, 12)
  }
}, { flush: 'sync' })

// 当城市切换或外部清空时，重置输入
watch(() => props.cityData, () => {
  startQuery.value = ''
  endQuery.value = ''
  startResults.value = []
  endResults.value = []
  emit('update:startId', '')
  emit('update:endId', '')
})

// 暴露给父组件：点击地图选站时填充当前激活的输入
function setStationFromMap(id) {
  const st = props.cityData?.stations?.[id]
  if (!st) return
  if (active.value === 'start') {
    emit('update:startId', id)
    startQuery.value = st.name
    startResults.value = []
    active.value = 'end'
  } else {
    emit('update:endId', id)
    endQuery.value = st.name
    endResults.value = []
  }
}
defineExpose({ setStationFromMap })
</script>
