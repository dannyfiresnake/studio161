<script setup>
import { config, getSource, getOutFxSource, getFxSource } from '../store.js'
import IconSvg from './IconSvg.vue'
import OutBox from './OutBox.vue'
import FxBox from './FxBox.vue'

const props = defineProps({
  entity: Object, // an input (isInput=true) or an fx (isInput=false)
  isInput: Boolean,
})

// For an input row the output box routes input→output; for an fx row it routes
// fx→output (the fx return, which only has a send toggle, no level).
const outSrc = (o) =>
  props.isInput ? getSource(props.entity.id, o.id) : getOutFxSource(props.entity.id, o.id)
const fxSrc = (fx) => getFxSource(props.entity.id, fx.id)
</script>

<template>
  <div class="input-row">
    <div class="input-label">
      <div class="input-icon">
        <IconSvg :file="entity.icon" :color="entity.color" :height="40 * (entity.icon_scale || 1)" />
      </div>
      <span class="input-name" :style="{ color: entity.color, fontSize: isInput ? '20px' : '25px' }">
        {{ entity.name }}
      </span>
    </div>

    <div class="input-outputs">
      <template v-for="o in config.outputs" :key="o.id">
        <OutBox v-if="outSrc(o)" :input="entity" :output="o" :src="outSrc(o)" :is-input="isInput" />
      </template>
    </div>

    <div class="input-fxs">
      <template v-if="isInput">
        <template v-for="fx in config.fx" :key="fx.id">
          <FxBox v-if="fxSrc(fx)" :input="entity" :fx="fx" :src="fxSrc(fx)" />
        </template>
      </template>
    </div>
  </div>
</template>
