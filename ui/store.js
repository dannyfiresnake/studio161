import { reactive, ref } from 'vue'

// ── Reactive app state ──
export const config = ref(null) // resolved config from /api/config
export const state = reactive({}) // wing property id → value (mutations drive the UI)
export const status = ref('disconnected') // 'disconnected' | 'connecting' | 'connected'
export const statusText = ref('Disconnected')
export const view = ref('mixer') // 'mixer' | 'settings'

let ws = null

const sourceKey = (a, b) => a + '|' + b

// ── Lookups (rebuilt when config loads) ──
const lookups = {
  outputsById: {},
  inputsById: {},
  fxById: {},
  sourcesByKey: {}, // input → output
  fxSourcesByKey: {}, // input → fx
  outFxSourcesByKey: {}, // fx → output
}

function buildLookups(cfg) {
  lookups.outputsById = {}
  lookups.inputsById = {}
  lookups.fxById = {}
  lookups.sourcesByKey = {}
  lookups.fxSourcesByKey = {}
  lookups.outFxSourcesByKey = {}
  for (const o of cfg.outputs) lookups.outputsById[o.id] = o
  for (const i of cfg.inputs) lookups.inputsById[i.id] = i
  for (const f of cfg.fx) lookups.fxById[f.id] = f
  for (const s of cfg.sources) lookups.sourcesByKey[sourceKey(s.input_id, s.output_id)] = s
  for (const s of cfg.fx_sources) lookups.fxSourcesByKey[sourceKey(s.input_id, s.output_id)] = s
  for (const s of cfg.output_fx_sources) lookups.outFxSourcesByKey[sourceKey(s.fx_id, s.output_id)] = s
}

export const getSource = (inputId, outputId) => lookups.sourcesByKey[sourceKey(inputId, outputId)]
export const getFxSource = (inputId, fxId) => lookups.fxSourcesByKey[sourceKey(inputId, fxId)]
export const getOutFxSource = (fxId, outputId) => lookups.outFxSourcesByKey[sourceKey(fxId, outputId)]
export const outputById = (id) => lookups.outputsById[id]

// ── WebSocket ──
export function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
}

// Auto-reconnect with backoff: 50ms doubling to 1s, then every 1s forever.
// Only an explicit disconnect (or sign-out) stops the retries.
const RETRY_MIN = 50
const RETRY_MAX = 1000
let retryDelay = RETRY_MIN
let retryTimer = null
let manualDisconnect = false
let autoRetry = false // mid reconnect-cycle: keeps the status text stable

function scheduleReconnect() {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, retryDelay)
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX)
}

export async function connect() {
  if (ws && ws.readyState <= 1) return // already connecting/connected
  manualDisconnect = false
  clearTimeout(retryTimer)
  status.value = 'connecting'
  statusText.value = autoRetry ? 'Reconnecting...' : 'Connecting...'

  if (!config.value) {
    const resp = await fetch('/api/config')
    config.value = await resp.json()
    buildLookups(config.value)
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(proto + '//' + location.host + '/ws')

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data)
    if (msg.type === 'connected') {
      status.value = 'connected'
      view.value = 'mixer'
      retryDelay = RETRY_MIN
      autoRetry = false
      requestAllData()
    } else if (msg.type === 'disconnected') {
      onDisconnected()
    } else if (
      msg.type === 'node_data_float' ||
      msg.type === 'node_data_int' ||
      msg.type === 'node_data_string'
    ) {
      state[msg.id] = msg.value
    }
  }

  ws.onclose = onDisconnected
  ws.onerror = onDisconnected
}

function onDisconnected() {
  ws = null
  view.value = 'mixer'
  if (manualDisconnect) {
    status.value = 'disconnected'
    statusText.value = 'Disconnected'
  } else {
    // Keep showing the spinner while the retry loop runs.
    autoRetry = true
    status.value = 'connecting'
    statusText.value = 'Reconnecting...'
    scheduleReconnect()
  }
}

export function disconnect() {
  manualDisconnect = true
  autoRetry = false
  clearTimeout(retryTimer)
  retryDelay = RETRY_MIN
  if (ws) ws.close()
  else {
    status.value = 'disconnected'
    statusText.value = 'Disconnected'
  }
}

function requestAllData() {
  const cfg = config.value
  const ids = new Set()
  for (const o of cfg.outputs) {
    ids.add(o.wing_prop_level)
    ids.add(o.wing_prop_mute)
  }
  for (const s of cfg.sources) {
    ids.add(s.wing_prop_send)
    ids.add(s.wing_prop_level)
  }
  for (const s of cfg.fx_sources) {
    ids.add(s.wing_prop_send)
    ids.add(s.wing_prop_level)
  }
  for (const s of cfg.output_fx_sources) {
    ids.add(s.wing_prop_send)
  }
  for (const id of ids) send({ cmd: 'request_node_data', id })
}
