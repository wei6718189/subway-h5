<template>
  <div v-if="!route" class="empty">输入起终点后点击「规划」查看换乘方案</div>
  <div v-else>
    <div class="route-summary">
      <span class="big">{{ formatMin(route.totalSec) }}</span>
      <span class="dim">约 {{ Math.round(route.totalSec / 60) }} 分钟</span>
      <span class="dim">| {{ route.stationCount }} 站</span>
      <span class="dim">| 换乘 {{ route.transferCount }} 次</span>
      <button class="btn ghost" style="margin-left:auto;padding:5px 10px" @click="$emit('clear')">清除</button>
    </div>
    <div class="leg-list">
      <template v-for="(leg, i) in route.legs" :key="i">
        <div class="leg" v-if="leg.lineId">
          <div class="bar" :style="{ background: lineColor(leg.lineId) }"></div>
          <div class="leg-body">
            <div class="leg-title">
              <span class="line-badge" :style="{ background: lineColor(leg.lineId) }">{{ leg.lineId }}</span>
              {{ lineName(leg.lineId) }}
            </div>
            <div class="leg-stops">
              {{ stopName(leg.stops[0]) }} → {{ stopName(leg.stops[leg.stops.length - 1]) }}
              <span v-if="leg.stops.length > 2">（途经 {{ leg.stops.length - 2 }} 站）</span>
            </div>
          </div>
        </div>
        <div class="transfer-note" v-if="i < route.legs.length - 1">
          在 {{ transferAt(leg, route.legs[i + 1]) }} 换乘 {{ route.legs[i + 1].lineId }}号线
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  route: { type: Object, default: null },
  cityData: { type: Object, default: null }
})
defineEmits(['clear'])

function lineColor(lineId) {
  return props.cityData?.lines?.find(l => l.id === lineId)?.color || '#666'
}
function lineName(lineId) {
  return props.cityData?.lines?.find(l => l.id === lineId)?.name || `${lineId}号线`
}
function stopName(id) {
  return props.cityData?.stations?.[id]?.name || id
}
function transferAt(prevLeg, nextLeg) {
  const last = prevLeg.stops[prevLeg.stops.length - 1]
  const first = nextLeg.stops[0]
  if (last === first) return stopName(last)
  return `${stopName(last)} → ${stopName(first)}`
}
function formatMin(sec) {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m}分`
  return `${Math.floor(m / 60)}小时${m % 60}分`
}
</script>
