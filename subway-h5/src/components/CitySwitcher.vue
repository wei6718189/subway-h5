<template>
  <select
    class="city-select"
    :value="current"
    @change="$emit('update:current', $event.target.value)"
  >
    <option v-for="c in cities" :key="c.id" :value="c.id">{{ c.name }}</option>
  </select>
</template>

<script setup>
import { CITIES } from '../lib/loadData.js'
defineProps({ current: { type: String, default: 'shenzhen' } })
defineEmits(['update:current'])
const cities = CITIES
</script>
