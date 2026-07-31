<template>
  <div class="chips">
    <button
      v-for="c in cities"
      :key="c.id"
      class="chip"
      :class="{ active: c.id === current }"
      @click="$emit('update:current', c.id)"
    >{{ c.name }}</button>
  </div>
</template>

<script setup>
import { CITIES } from '../lib/loadData.js'
defineProps({ current: { type: String, default: 'shenzhen' } })
defineEmits(['update:current'])
const cities = CITIES
</script>
