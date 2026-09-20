<script setup>
import { computed, ref } from 'vue'
import { state, send } from '../store.js'

const props = defineProps({
  input: Object,
  fx: Object,
  src: Object,
})

const dragging = ref(false)

const enabled = computed(() => (state[props.src.wing_prop_send] || 0) !== 0)
const level = computed(() => state[props.src.wing_prop_level] ?? 0)
const volText = computed(() => (level.value === -144 ? '-∞' : level.value.toFixed(1)))

const ringStyle = computed(() => ({
  borderColor: props.input.color,
  // While dragging, drop the dark gradient fill so the level number isn't shown
  // over a black background — just the color-outlined ring.
  background: !dragging.value && enabled.value ? `linear-gradient(to bottom, ${props.input.color}, #000)` : '',
}))

// Arc meter, drawn as SVG paths (20 segments). SVG avoids the WebKit bug where a
// transparent <canvas> in a composited layer (triggered by setPointerCapture
// during a drag) renders its backing as an opaque black rectangle.
const arcs = computed(() => {
  if (!enabled.value) return []
  const lv = level.value
  const cx = 50, cy = 50, r = 46, PI = Math.PI, span = 2 * PI * 0.03
  const out = []
  for (let i = 0; i < 20; i++) {
    let color = null
    if (lv < 0 && i * -0.5 > lv) color = '#f44336'
    else if (lv > 0 && i * 0.5 < lv) color = '#4caf50'
    if (!color) continue
    // negative arcs go clockwise from bottom, positive go counter-clockwise
    const a1 = PI / 2 + (lv < 0 ? 1 : -1) * (2 * PI * 0.05 * i)
    const a2 = a1 + span
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2)
    out.push({ d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, color })
  }
  return out
})

// ── Interaction ──
// Drag is driven by window-level listeners rather than setPointerCapture:
// pointer capture promotes the element to a composited layer that WebKit
// (WKWebView) then paints as an opaque black rectangle behind the transparent
// ring, and the artifact persists after the drag.
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
    class="fxbox"
    :style="{ '--input-color': input.color }"
    @click="onClick"
    @pointerdown="onDown"
  >
    <div class="fxbox-ring" :style="ringStyle">
      <!-- Show the level while dragging, whether or not the send is enabled. -->
      <span v-if="dragging" class="fxbox-volume" style="color: #fff">{{ volText }}</span>
    </div>
    <svg v-if="arcs.length" class="fxbox-meter" viewBox="0 0 100 100">
      <path v-for="(a, i) in arcs" :key="i" :d="a.d" :stroke="a.color" stroke-width="12" fill="none" />
    </svg>
  </div>
</template>
