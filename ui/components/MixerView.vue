<script setup>
import { config, view } from '../store.js'
import OutputHeader from './OutputHeader.vue'
import InputRow from './InputRow.vue'
</script>

<template>
  <div id="mixer">
    <!-- Header row: output controllers + FX labels -->
    <div class="header-row">
      <div class="header-left">
        <span id="gear-btn" title="Settings" @click="view = 'settings'">
          <svg viewBox="0 0 24 24">
            <path d="M9.75 2.26 A10.0 10.0 0 0 1 14.25 2.26 L14.70 5.65 A6.9 6.9 0 0 1 16.15 6.49 L19.31 5.18 A10.0 10.0 0 0 1 21.56 9.08 L18.85 11.16 A6.9 6.9 0 0 1 18.85 12.84 L21.56 14.92 A10.0 10.0 0 0 1 19.31 18.82 L16.15 17.51 A6.9 6.9 0 0 1 14.70 18.35 L14.25 21.74 A10.0 10.0 0 0 1 9.75 21.74 L9.30 18.35 A6.9 6.9 0 0 1 7.85 17.51 L4.69 18.82 A10.0 10.0 0 0 1 2.44 14.92 L5.15 12.84 A6.9 6.9 0 0 1 5.15 11.16 L2.44 9.08 A10.0 10.0 0 0 1 4.69 5.18 L7.85 6.49 A6.9 6.9 0 0 1 9.30 5.65 L9.75 2.26 Z" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </span>
      </div>
      <div class="header-outputs">
        <OutputHeader v-for="o in config.outputs" :key="o.id" :output="o" />
      </div>
      <div class="header-fx">
        <span v-for="f in config.fx" :key="f.id">FX {{ f.name }}</span>
      </div>
    </div>

    <!-- Input rows, then FX rows -->
    <div id="input-rows">
      <InputRow v-for="inp in config.inputs" :key="'in-' + inp.id" :entity="inp" :is-input="true" />
      <InputRow v-for="fx in config.fx" :key="'fx-' + fx.id" :entity="fx" :is-input="false" />
    </div>
  </div>
</template>
