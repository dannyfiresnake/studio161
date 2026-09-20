<script setup>
import { onMounted } from 'vue'
import { status, view, connect } from './store.js'
import { toasts, needLogin, conflict, startCloud } from './cloud.js'
import ConnectScreen from './components/ConnectScreen.vue'
import MixerView from './components/MixerView.vue'
import SettingsView from './components/SettingsView.vue'
import CloudLogin from './components/CloudLogin.vue'
import ConflictDialog from './components/ConflictDialog.vue'

onMounted(() => {
  connect()
  startCloud()
})
</script>

<template>
  <div id="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast">{{ t.msg }}</div>
  </div>
  <CloudLogin v-if="needLogin" />
  <ConflictDialog v-if="conflict" />
  <ConnectScreen v-if="status !== 'connected'" />
  <template v-else>
    <MixerView v-show="view === 'mixer'" />
    <SettingsView v-if="view === 'settings'" />
  </template>
</template>
