<template>
  <div v-if="!routes || !routes.length" class="empty">输入起终点后点击「规划」查看换乘方案</div>
  <div v-else>
    <div class="plan-tabs">
      <button
        v-for="p in routes"
        :key="p.key"
        :class="['plan-tab', { active: p.key === activeKey }]"
        @click="$emit('select', p.key)"
      >
        <span class="tab-label">{{ p.label }}</span>
        <span class="tab-meta">{{ Math.round(p.route.totalSec / 60) }}分 · {{ p.route.stationCount }}站 · 换乘{{ p.route.transferCount }}</span>
      </button>
    </div>
    <div class="plan-detail" v-if="activePlan">
      <div class="route-summary">
        <span class="big">{{ formatMin(activePlan.route.totalSec) }}</span>
        <span class="dim">约 {{ Math.round(activePlan.route.totalSec / 60) }} 分钟</span>
        <span class="dim">· {{ activePlan.route.stationCount }} 站</span>
        <span class="dim">· 换乘 {{ activePlan.route.transferCount }} 次</span>
      </div>
      <div class="leg-list">
        <template v-for="(leg, i) in activePlan.route.legs" :key="i">
          <div class="leg" v-if="leg.lineId">
            <div class="bar" :style="{ background: lineColor(leg.lineId) }"></div>
            <div class="leg-body">
              <div class="leg-title">
                <span class="line-badge" :style="{ background: lineColor(leg.lineId) }">{{ shortLineName(leg.lineId) }}</span>
                {{ fullLineName(leg.lineId) }}
              </div>
              <div class="leg-stops">
                {{ stopName(leg.stops[0]) }} → {{ stopName(leg.stops[leg.stops.length - 1]) }}
                <span v-if="leg.stops.length > 2">（途经 {{ leg.stops.length - 2 }} 站）</span>
              </div>
            </div>
          </div>
          <div class="transfer-note" v-if="i < activePlan.route.legs.length - 1">
            在 {{ transferAt(leg, activePlan.route.legs[i + 1]) }} 换乘 {{ shortLineName(activePlan.route.legs[i + 1].lineId) }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  routes: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' },
  cityData: { type: Object, default: null }
})
defineEmits(['select', 'clear'])

const activePlan = computed(() => {
  const found = props.routes.find(r => r.key === props.activeKey)
  return found || props.routes[0]
})

function lineColor(lineId) {
  return props.cityData?.lines?.find(l => l.id === lineId)?.color || '#666'
}
function lineName(lineId) {
  return props.cityData?.lines?.find(l => l.id === lineId)?.name || `${lineId}号线`
}
// 短名：提取 "X号线" 部分
function shortLineName(lineId) {
  const name = lineName(lineId)
  const m = name.match(/(\d+[^线]*线)/)
  if (m) return m[1]
  const m2 = name.match(/(\d+号线)/)
  if (m2) return m2[1]
  return name.split('/')[0].trim()
}
function fullLineName(lineId) {
  return lineName(lineId)
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

<style scoped>
.plan-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.plan-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}
.plan-tab.active {
  border-color: #2f7cf6;
  background: #eef4ff;
  box-shadow: 0 0 0 2px rgba(47, 124, 246, 0.15);
}
.tab-label {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
}
.tab-meta {
  font-size: 11px;
  color: #888;
}
</style>
