<script setup>
import { computed, ref } from 'vue'
import { state, send } from '../store.js'
import { darken } from '../lib/color.js'
import IconSvg from './IconSvg.vue'

const props = defineProps({
  input: Object,
  output: Object,
  src: Object,
  isInput: Boolean,
})

const dragging = ref(false)

const hasLevel = computed(() => props.src.wing_prop_level != null)
const enabled = computed(() => (state[props.src.wing_prop_send] || 0) !== 0)
const muted = computed(() => (state[props.output.wing_prop_mute] || 0) !== 0)
const level = computed(() => (hasLevel.value ? state[props.src.wing_prop_level] ?? 0 : null))

const classes = computed(() => [
  'outbox',
  enabled.value ? 'enabled' : 'disabled',
  muted.value ? 'muted' : '',
])

const boxStyle = computed(() => {
  const c = props.input.color
  // While dragging, drop the dark gradient fill so the volume number isn't over black.
  if (enabled.value && !dragging.value) {
    return {
      '--input-color': c,
      background: `linear-gradient(to bottom, ${c}, ${darken(c, 0.5)}, #000)`,
      borderColor: c,
    }
  }
  return { '--input-color': c, background: '', borderColor: enabled.value ? c : darken(c, 0.7) }
})

const volText = computed(() => (level.value === -144 ? '-∞' : (level.value ?? 0).toFixed(1)))

const meterSegs = computed(() => {
  if (level.value == null || !enabled.value) return null
  const lv = level.value
  const segs = []
  for (let i = 0; i < 20; i++) {
    const on = lv < 0 ? (19 - i) * -0.5 > lv : i * 0.5 < lv
    segs.push(on ? (lv < 0 ? '#f44336' : '#4caf50') : '')
  }
  return segs
})

// ── Interaction ──
// Drag via window listeners, not setPointerCapture — pointer capture promotes
// the box to a composited layer that WebKit (WKWebView) leaves painted black
// once the gradient fill is dropped during the drag.
let wasDrag = false

function onClick() {
  if (wasDrag) {
    wasDrag = false
    return
  }
  const val = enabled.value ? 0 : 1
  send({ cmd: 'set_int', id: props.src.wing_prop_send, value: val })
  state[props.src.wing_prop_send] = val
}

function onDown(e) {
  if (!(props.isInput && hasLevel.value)) return // level drag is inputs-only
  const startX = e.clientX
  const origLevel = state[props.src.wing_prop_level] ?? 0
  let didDrag = false
  const move = (ev) => {
    const dx = ev.clientX - startX
    if (Math.abs(dx) > 3) didDrag = true
    if (!didDrag) return
    dragging.value = true
    let nl = origLevel + dx / 40
    nl = nl === -144 ? -144 : Math.max(-90, Math.min(10, nl))
    nl = Math.round(nl * 2) / 2
    if (nl !== state[props.src.wing_prop_level]) {
      state[props.src.wing_prop_level] = nl
      send({ cmd: 'set_float', id: props.src.wing_prop_level, value: nl })
    }
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    wasDrag = didDrag
    if (dragging.value) dragging.value = false
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}
</script>

<template>
  <div
    :class="classes"
    :style="boxStyle"
    @click="onClick"
    @pointerdown="onDown"
  >
    <span v-if="dragging && level != null" class="outbox-volume" :style="{ color: output.color }">
      {{ volText }}
    </span>
    <div v-else class="outbox-icon">
      <IconSvg :file="output.icon" :color="output.color" :height="36 * (output.icon_scale || 1)" />
    </div>

    <div v-if="meterSegs" class="outbox-meter">
      <div v-for="(c, i) in meterSegs" :key="i" class="seg" :style="{ background: c }"></div>
    </div>
  </div>
</template>
