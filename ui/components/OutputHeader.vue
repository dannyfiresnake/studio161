<script setup>
import { computed } from 'vue'
import { state, send } from '../store.js'
import { dbToSpl, splToDb } from '../lib/volume.js'

const props = defineProps({ output: Object })

const level = computed(() => state[props.output.wing_prop_level] ?? -144)
const muted = computed(() => (state[props.output.wing_prop_mute] || 0) !== 0)
const spl = computed(() => dbToSpl(level.value))

const segs = computed(() => {
  const out = []
  for (let i = 0; i < 20; i++) {
    if (i < spl.value) out.push(i < 13 ? 'on-green' : i === 13 ? 'on-white' : 'on-red')
    else out.push(i === 13 ? 'off-zero' : 'off')
  }
  return out
})

function toggleMute() {
  const m = muted.value
  send({ cmd: 'set_int', id: props.output.wing_prop_mute, value: m ? 0 : 1 })
  state[props.output.wing_prop_mute] = m ? 0 : 1
}

// Drag on the level-bar area (not the top bar) to adjust the output level.
// Uses window listeners rather than setPointerCapture (avoids WebKit's
// composited-layer black-backing artifact seen on the other draggable boxes).
function onDown(e) {
  if (e.target.closest('.output-header-top')) return
  const startX = e.clientX
  const origLevel = state[props.output.wing_prop_level] ?? -144
  const move = (ev) => {
    const dx = ev.clientX - startX
    if (Math.abs(dx) <= 3) return
    const origSpl = dbToSpl(origLevel)
    const newDb = splToDb(Math.round(origSpl + dx / 40))
    if (newDb !== (state[props.output.wing_prop_level] ?? -144)) {
      state[props.output.wing_prop_level] = newDb
      send({ cmd: 'set_float', id: props.output.wing_prop_level, value: newDb })
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
</script>

<template>
  <div class="output-header" @pointerdown="onDown">
    <div class="output-header-top" @click.stop="toggleMute">
      <span class="oh-name" :style="{ color: output.color }">{{ output.name }}</span>
    </div>
    <div class="level-bar">
      <div v-for="(c, i) in segs" :key="i" class="seg" :class="c"></div>
    </div>
    <div class="muted-label" :class="{ active: muted }" @click.stop="toggleMute" @pointerdown.stop>
      MUTED
    </div>
  </div>
</template>
