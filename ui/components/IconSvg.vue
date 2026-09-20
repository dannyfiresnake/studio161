<script setup>
import { ref, watchEffect } from 'vue'
import { coloredSvg } from '../lib/icons.js'

const props = defineProps({
  file: String,
  color: { type: String, default: '#fff' },
  height: { type: Number, default: 40 },
})

const el = ref(null)

watchEffect(async () => {
  // Read reactive deps synchronously so they're tracked before the await.
  const { file, color, height } = props
  const host = el.value
  if (!file || !host) return
  const markup = await coloredSvg(file, color || '#fff', height)
  if (el.value) el.value.innerHTML = markup
})
</script>

<template>
  <span ref="el" class="icon-svg"></span>
</template>
