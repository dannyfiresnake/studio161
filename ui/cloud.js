import { ref, watch } from 'vue'
import { view, connect, disconnect } from './store.js'

// ── Cloud settings (Cloudflare worker backed by KV) ──
// The cloud copy is the source of truth, synced three-way: we remember the
// last-synced config ("base") so we can tell who changed. Cloud changed →
// pull; local changed → push; both changed → ask the user which to keep.
export const CLOUD_URL = 'https://studio161-settings.ishiboo.workers.dev/'

export const cloudUser = ref(localStorage.getItem('cloudUser') || '')
export const cloudPass = ref(localStorage.getItem('cloudPass') || '')
export const needLogin = ref(false)
export const loginError = ref('')
export const cloudBusy = ref(false)
export const conflict = ref(false) // shows the sync-conflict dialog
export const historyPos = ref({ active: 0, length: 0 }) // cloud undo-stack position
export const cloudOnline = ref(true) // last cloud request succeeded (reachability)

watch(cloudUser, (v) => localStorage.setItem('cloudUser', v))
watch(cloudPass, (v) => localStorage.setItem('cloudPass', v))

const auth = () => 'Basic ' + btoa(cloudUser.value + ':' + cloudPass.value)
const hasCreds = () => cloudUser.value !== '' && cloudPass.value !== ''

let paused = false // user cancelled a sign-in; sync stays off until they sign in

// ── Toasts ──
export const toasts = ref([])
let toastId = 0

export function toast(msg, ms = 6000) {
  console.log('[cloud]', msg)
  const id = ++toastId
  toasts.value.push({ id, msg })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, ms)
}

// A toast that survives the location.reload() after applying a config.
const setPendingToast = (msg) => sessionStorage.setItem('pendingToast', msg)
function consumePendingToast() {
  const msg = sessionStorage.getItem('pendingToast')
  if (msg) {
    sessionStorage.removeItem('pendingToast')
    toast(msg)
  }
  return !!msg
}

// ── Sync-state tracking ──
// lastVersion: the cloud version at our last sync.
// base: canonical form of the config as of our last sync — the common
// ancestor for three-way comparison.
let lastVersion = localStorage.getItem('cloudVersion') || ''
let baseline = null // canonical server config as of page load (staleness check)

function setSynced(version, canonicalCfg) {
  lastVersion = version || ''
  localStorage.setItem('cloudVersion', lastVersion)
  localStorage.setItem('cloudBase', canonicalCfg)
}

// Stringify with object keys sorted, so configs compare equal regardless of
// key order (the local server returns alphabetized keys, browsers preserve
// insertion order).
function canonical(v) {
  return JSON.stringify(v, (k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val).sort().map((key) => [key, val[key]]))
      : val
  )
}

async function fetchServerConfig() {
  const resp = await fetch('/api/config/raw')
  return resp.ok ? resp.json() : null
}

async function postServerConfig(cfg) {
  return fetch('/api/config/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  })
}

// Single chokepoint for worker requests; tracks reachability in cloudOnline.
// Exported for other modules (e.g. the icon library) that need authed access.
export function fetchCloud(path = '', options = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  return fetch(CLOUD_URL + path, {
    ...options,
    headers: { Authorization: auth(), ...(options.headers || {}) },
    signal: ctrl.signal,
  })
    .then((r) => {
      cloudOnline.value = true
      return r
    })
    .catch((e) => {
      cloudOnline.value = false
      throw e
    })
    .finally(() => clearTimeout(t))
}

// PUT the config to the cloud. Returns an error string, or null on success.
async function putCloudConfig(cfg) {
  try {
    const resp = await fetchCloud('', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (!resp.ok) return 'cloud save failed: ' + resp.status + ' ' + (await resp.text())
    const data = await resp.json()
    setSynced(data.version, canonical(cfg))
    historyPos.value = { active: data.active, length: data.length }
    return null
  } catch {
    return 'cloud save failed: cloud unreachable'
  }
}

// ── Save (used by the settings editor's autosave) ──
// Saves to the local server (immediate effect) and to the cloud (source of
// truth). No reload — the editor stays live. Returns an error string or null.
// If the cloud write fails, the base is left stale so the next sync sees the
// local change and pushes it.
export async function saveNow(cfg) {
  const resp = await postServerConfig(cfg).catch(() => null)
  if (!resp || !resp.ok) return 'local save failed'
  if (!hasCreds()) return 'not signed in to cloud'
  return putCloudConfig(cfg)
}

// ── Cloud undo/redo (the undo stack lives in the worker) ──
// Moves the cloud's active pointer, applies the resulting config to the local
// server, and returns {config} for the editor to display, or {error}.
export async function cloudHistoryStep(op) {
  try {
    const resp = await fetchCloud(op, { method: 'POST' })
    const data = await resp.json().catch(() => null)
    if (data && data.active !== undefined) {
      historyPos.value = { active: data.active, length: data.length }
    }
    if (!resp.ok || !data?.ok) return { error: data?.error || 'cloud error ' + resp.status }
    const save = await postServerConfig(data.config)
    if (!save.ok) return { error: 'local apply failed' }
    setSynced(data.version, canonical(data.config))
    return { config: data.config }
  } catch {
    return { error: 'cloud unreachable' }
  }
}

// ── Three-way sync ──
async function pull(cloudCfg, version, startup) {
  const save = await postServerConfig(cloudCfg)
  if (save.ok) {
    setSynced(version, canonical(cloudCfg))
    setPendingToast(startup ? '✓ Settings loaded from cloud' : '✓ Settings updated from cloud')
    location.reload()
  }
}

async function push(serverCfg) {
  const err = await putCloudConfig(serverCfg) // updates base + version on success
  toast(err ? '⚠ ' + err : '✓ Local changes pushed to cloud')
}

let conflictData = null // {cloudCfg, serverCfg, version} while the dialog is up
let conflictDismissedVersion = ''

async function sync({ startup = false, manual = false, quiet = false } = {}) {
  try {
    const resp = await fetchCloud()
    if (resp.status === 401) {
      loginError.value = 'Invalid username or password'
      needLogin.value = true
      return
    }
    if (resp.status === 404) {
      // Nothing in the cloud yet: seed it from the current settings.
      const serverCfg = await fetchServerConfig()
      if (serverCfg && !(await putCloudConfig(serverCfg))) {
        toast('✓ Cloud initialized with current settings')
      }
      return
    }
    if (!resp.ok) throw new Error('cloud error ' + resp.status)

    const cloudCfg = await resp.json()
    const version = resp.headers.get('X-Config-Version') || ''
    const active = parseInt(resp.headers.get('X-Active') ?? '', 10)
    const length = parseInt(resp.headers.get('X-Length') ?? '', 10)
    if (!isNaN(active) && !isNaN(length)) historyPos.value = { active, length }
    const serverCfg = await fetchServerConfig()
    if (!serverCfg) return

    const cloudC = canonical(cloudCfg)
    const localC = canonical(serverCfg)
    const base = localStorage.getItem('cloudBase') || ''

    if (cloudC === localC) {
      setSynced(version, cloudC)
      if (baseline && localC !== baseline) {
        // Another device already applied this config to our server; our page
        // predates it and is stale.
        setPendingToast('✓ Settings updated from cloud')
        location.reload()
        return
      }
      if ((startup && !quiet) || manual) toast('✓ Cloud connected — settings up to date')
      return
    }

    // Who changed since the last sync? Without a stored base (first sync
    // after this feature), fall back to the version marker: an unchanged
    // version means the difference must be local.
    const cloudChanged = base ? cloudC !== base : version !== lastVersion
    const localChanged = base ? localC !== base : version === lastVersion

    if (cloudChanged && !localChanged) return pull(cloudCfg, version, startup)
    if (localChanged && !cloudChanged) return push(serverCfg)

    // Both changed (or we can't tell): ask the user which to keep.
    if (!manual && version === conflictDismissedVersion) return
    conflictData = { cloudCfg, serverCfg, version }
    conflict.value = true
  } catch {
    if (startup) toast('⚠ Cloud unreachable — using last saved settings')
    else if (manual) toast('⚠ Cloud unreachable')
  }
}

export async function resolveConflict(keep) {
  const data = conflictData
  conflict.value = false
  conflictData = null
  if (!data) return
  if (keep === 'cloud') await pull(data.cloudCfg, data.version, false)
  else await push(data.serverCfg)
}

export function dismissConflict() {
  conflictDismissedVersion = conflictData?.version || ''
  conflict.value = false
  conflictData = null
  toast('⚠ Sync conflict unresolved — use Force Sync to decide later')
}

// Manual sync from the ⋯ menu.
export function forceSync() {
  return sync({ manual: true })
}

// ── Sign-in ──
export async function submitLogin() {
  cloudBusy.value = true
  loginError.value = ''
  try {
    const resp = await fetchCloud('version')
    if (resp.status === 401) {
      loginError.value = 'Invalid username or password'
      return
    }
    if (!resp.ok) {
      loginError.value = 'Cloud error: ' + resp.status
      return
    }
    needLogin.value = false
    paused = false
    connect() // resume the mixer connection (no-op if already connected)
    await sync({ startup: true })
  } catch {
    loginError.value = 'Cannot reach the cloud — check your connection'
  } finally {
    cloudBusy.value = false
  }
}

export function cancelLogin() {
  needLogin.value = false
  paused = true
  toast('⚠ Cloud sync paused — sign in from Settings to resume')
}

export function requestLogin() {
  loginError.value = ''
  needLogin.value = true
}

// Clear the stored credentials on this device and show the sign-in.
// Also stops the mixer's auto-reconnect loop.
export function signOut() {
  disconnect()
  cloudUser.value = ''
  cloudPass.value = ''
  localStorage.removeItem('cloudVersion')
  localStorage.removeItem('cloudBase')
  lastVersion = ''
  paused = false
  loginError.value = ''
  needLogin.value = true
}

// ── Startup + background polling ──
let timer = null

async function checkCloud() {
  if (!hasCreds() || needLogin.value || paused || document.hidden || cloudBusy.value) return
  if (conflict.value) return // a decision is already pending
  try {
    // The version fetch always runs — it keeps cloudOnline fresh even while
    // editing — but we don't apply sync changes under an open editor.
    const resp = await fetchCloud('version')
    if (resp.status === 401) {
      loginError.value = 'Invalid username or password'
      needLogin.value = true
      return
    }
    if (!resp.ok) return
    if (view.value === 'settings') return // don't clobber an edit in progress
    const { version } = await resp.json()
    if (!version || version === lastVersion) return
    await sync()
  } catch {
    // Offline or worker unreachable; try again on the next tick.
  }
}

export async function startCloud() {
  if (timer) return
  const hadPending = consumePendingToast()
  fetchServerConfig().then((cfg) => {
    if (cfg) baseline = canonical(cfg)
  })
  timer = setInterval(checkCloud, 20000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkCloud()
  })

  if (!hasCreds()) {
    needLogin.value = true
    return
  }
  await sync({ startup: true, quiet: hadPending })
}
