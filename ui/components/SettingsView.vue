<script setup>
import { ref, reactive, onMounted, watch, nextTick, computed } from 'vue'
import { view, disconnect } from '../store.js'
import { cloudUser, cloudOnline, saveNow, cloudHistoryStep, historyPos, signOut, forceSync, toast } from '../cloud.js'
import { customIconList, loadCustomIconList, uploadCustomIcon, deleteCustomIcon } from '../lib/icons.js'
import IconSvg from './IconSvg.vue'

const AVAILABLE_ICONS = [
  'ableton.svg', 'barcelona.svg', 'cable.svg', 'drums.svg', 'fx.svg', 'guitar.svg',
  'headphones.svg', 'laptop.svg', 'microphone.svg', 'midi.svg', 'pc.svg', 'piano.svg',
  'speaker.svg', 'tablet.svg',
]

// The raw (unresolved) config, edited in place then POSTed back.
const raw = ref(null)

onMounted(async () => {
  loadCustomIconList()
  const resp = await fetch('/api/config/raw')
  raw.value = reactive(await resp.json())
  watch(raw, onEdit, { deep: true })
})

const sections = [
  {
    key: 'outputs',
    title: 'Outputs',
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'iconScale', label: 'Scale', type: 'number', step: 0.1 },
      { key: '_output_type', label: 'Type', type: 'output_type' },
    ],
  },
  {
    key: 'inputs',
    title: 'Inputs',
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'iconScale', label: 'Scale', type: 'number', step: 0.1 },
      { key: 'channel', label: 'Channel', type: 'number' },
    ],
  },
  {
    key: 'fx',
    title: 'FX',
    fields: [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'color', label: 'Color', type: 'color' },
      { key: 'icon', label: 'Icon', type: 'icon' },
      { key: 'iconScale', label: 'Scale', type: 'number', step: 0.1 },
      { key: 'bus', label: 'Bus', type: 'number' },
    ],
  },
]

function addItem(section) {
  const item = {}
  for (const f of section.fields) {
    if (f.type === 'text') item[f.key] = ''
    else if (f.type === 'color') item[f.key] = '#ffffff'
    else if (f.type === 'icon') item[f.key] = AVAILABLE_ICONS[0]
    else if (f.type === 'number') item[f.key] = undefined
  }
  raw.value[section.key].push(item)
}

function removeItem(sectionKey, idx) {
  raw.value[sectionKey].splice(idx, 1)
}

// ── Number fields ──
function numVal(item, f) {
  if (f.key === 'iconScale') return item.iconScale ?? 1.0
  return item[f.key] ?? ''
}
function setNum(item, f, val) {
  item[f.key] = val === '' ? undefined : f.step ? parseFloat(val) : parseInt(val)
}

// ── Output "type": either a `main` or a `bus` number (mutually exclusive) ──
function otType(item) {
  return item.main !== undefined ? 'main' : item.bus !== undefined ? 'bus' : 'main'
}
function setOtType(item, t) {
  const old = t === 'main' ? 'bus' : 'main'
  const val = item[old]
  delete item[old]
  item[t] = val
}
function otVal(item) {
  return item.main ?? item.bus ?? ''
}
function setOtVal(item, val) {
  item[otType(item)] = parseInt(val) || undefined
}

// ── Drag to reorder (live shuffle within the section array) ──
const drag = reactive({ section: null, index: -1 })

function startDrag(e, section, idx) {
  e.preventDefault()
  const list = e.target.closest('.settings-section').querySelector('.settings-list')
  drag.section = section.key
  drag.index = idx

  const onMove = (ev) => {
    const items = Array.from(list.querySelectorAll('.settings-item'))
    let newIdx = items.length - 1
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect()
      if (ev.clientY < r.top + r.height / 2) {
        newIdx = i
        break
      }
    }
    if (newIdx !== drag.index && newIdx >= 0) {
      const arr = raw.value[drag.section]
      const [moved] = arr.splice(drag.index, 1)
      arr.splice(newIdx, 0, moved)
      drag.index = newIdx
    }
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    drag.section = null
    drag.index = -1
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

function cleanConfig() {
  // Strip undefined values and the default iconScale (1.0).
  return JSON.parse(
    JSON.stringify(raw.value, (k, v) => {
      if (v === undefined) return undefined
      if (k === 'iconScale' && v === 1.0) return undefined
      return v
    })
  )
}

// ── Autosave ──
// Every edit is saved (debounced) to the local server and the cloud, where it
// becomes a new state on the shared undo stack. The top-bar icon reflects it:
// spinner = saving, ✓ = saved, ✗ = failed.
const saveState = ref('idle') // 'idle' | 'saving' | 'saved' | 'error'
let saveTimer = null
let editPending = false
let applyingHistory = false
let savedAnything = false

function onEdit() {
  if (applyingHistory) return
  editPending = true
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 800)
}

async function flush() {
  clearTimeout(saveTimer)
  if (!editPending) return
  editPending = false
  const err = await saveNow(cleanConfig())
  saveState.value = err ? 'error' : 'saved'
  savedAnything = true
  if (err) toast('⚠ ' + err)
}

// ── Undo / redo (the stack lives in the cloud, shared by all devices) ──
const canUndo = computed(() => cloudOnline.value && historyPos.value.active > 0)
const canRedo = computed(() => cloudOnline.value && historyPos.value.active < historyPos.value.length - 1)
const undoTitle = computed(() => (cloudOnline.value ? 'Undo' : 'Cloud offline — undo unavailable'))
const redoTitle = computed(() => (cloudOnline.value ? 'Redo' : 'Cloud offline — redo unavailable'))

async function historyStep(op) {
  saveState.value = 'saving'
  await flush() // an unsaved edit becomes a state first, so undo undoes it
  const res = await cloudHistoryStep(op)
  if (res.error) {
    saveState.value = 'error'
    toast('⚠ ' + res.error)
    return
  }
  applyingHistory = true
  raw.value = reactive(res.config)
  await nextTick()
  applyingHistory = false
  savedAnything = true
  saveState.value = 'saved'
}

async function back() {
  await flush()
  if (savedAnything) location.reload() // pick up the new resolved config
  else view.value = 'mixer'
}

// ── Icon picker ──
// Custom icons are shared assets in the cloud worker's icon library,
// referenced by items as "custom:<name>" (see ../lib/icons.js).
const pickerFor = ref(null) // `${sectionKey}:${idx}` of the open picker
const customIconNames = computed(() => customIconList.value)

function togglePicker(sectionKey, idx) {
  const key = sectionKey + ':' + idx
  pickerFor.value = pickerFor.value === key ? null : key
}

function pickIcon(item, icon) {
  item.icon = icon
  pickerFor.value = null
}

async function uploadIcon(e, item) {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const text = await file.text()
  if (!text.includes('<svg')) return toast('⚠ Not an SVG file')
  if (text.length > 200_000) return toast('⚠ SVG too large (max 200KB)')
  const base =
    file.name.replace(/\.svg$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ||
    'icon'
  let name = base
  for (let n = 2; customIconList.value.includes(name); n++) name = base + '-' + n
  try {
    await uploadCustomIcon(name, text)
  } catch (err) {
    return toast('⚠ Icon upload failed: ' + err.message)
  }
  item.icon = 'custom:' + name
  pickerFor.value = null
}

async function removeIcon(name) {
  try {
    await deleteCustomIcon(name)
  } catch (err) {
    return toast('⚠ Icon delete failed: ' + err.message)
  }
  // Reset anything still using it to a built-in icon.
  for (const key of ['outputs', 'inputs', 'fx']) {
    for (const it of raw.value[key] || []) {
      if (it.icon === 'custom:' + name) it.icon = AVAILABLE_ICONS[0]
    }
  }
}

// ── ⋯ menu ──
const menuOpen = ref(false)

function menuAction(fn) {
  menuOpen.value = false
  fn()
}
</script>

<template>
  <div id="settings" v-if="raw">
    <div class="settings-top">
      <div class="settings-top-inner">
        <div class="settings-top-actions">
          <button class="icon-btn" title="Back" @click="back">
            <svg viewBox="0 0 24 24"><polyline points="15.5 4 7.5 12 15.5 20" /></svg>
          </button>
          <button class="icon-btn" :title="undoTitle" :disabled="!canUndo" @click="historyStep('undo')">
            <svg viewBox="0 0 24 24">
              <polyline points="7.5 4 3 8.5 7.5 13" />
              <path d="M3 8.5 H14.5 a5.25 5.25 0 0 1 0 10.5 H9" />
            </svg>
          </button>
          <button class="icon-btn" :title="redoTitle" :disabled="!canRedo" @click="historyStep('redo')">
            <svg viewBox="0 0 24 24">
              <polyline points="16.5 4 21 8.5 16.5 13" />
              <path d="M21 8.5 H9.5 a5.25 5.25 0 0 0 0 10.5 H15" />
            </svg>
          </button>
        </div>
        <div class="settings-top-right">
          <span class="save-state">
            <span v-if="saveState === 'saving'" class="spinner spinner-sm"></span>
            <span v-else-if="saveState === 'saved'" class="state-ok">&#10003;</span>
            <span v-else-if="saveState === 'error'" class="state-err">&#10007;</span>
          </span>
          <span class="signed-in">{{ cloudUser ? 'Signed in as ' + cloudUser : 'Not signed in' }}</span>
          <button class="menu-btn" title="Menu" @click="menuOpen = !menuOpen">
            <svg viewBox="0 0 24 24" class="filled">
              <circle cx="5" cy="12" r="2.1" />
              <circle cx="12" cy="12" r="2.1" />
              <circle cx="19" cy="12" r="2.1" />
            </svg>
          </button>
          <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
          <div v-if="menuOpen" class="menu">
            <div class="menu-item" @click="menuAction(forceSync)">Force Sync</div>
            <div class="menu-item" @click="menuAction(signOut)">Sign Out</div>
            <div class="menu-item" @click="menuAction(disconnect)">Disconnect from Mixer</div>
          </div>
        </div>
      </div>
    </div>

    <div v-for="section in sections" :key="section.key" class="settings-section">
      <div class="settings-header">
        <h2>{{ section.title }}</h2>
        <button @click="addItem(section)">+ Add</button>
      </div>

      <div class="settings-list">
        <div
          v-for="(item, idx) in raw[section.key]"
          :key="idx"
          class="settings-item"
          :class="{ dragging: drag.section === section.key && drag.index === idx }"
        >
          <span class="drag-handle" @pointerdown="startDrag($event, section, idx)">⠿</span>

          <div class="icon-preview">
            <IconSvg
              v-if="item.icon"
              :file="item.icon"
              :color="item.color || '#fff'"
              :height="20 * (item.iconScale || 1)"
            />
          </div>

          <div v-for="f in section.fields" :key="f.key" class="field">
            <label>{{ f.label }}</label>

            <template v-if="f.type === 'output_type'">
              <div style="display: flex; gap: 6px; align-items: center">
                <select :value="otType(item)" @change="setOtType(item, $event.target.value)">
                  <option value="main">Main</option>
                  <option value="bus">Bus</option>
                </select>
                <input type="number" :value="otVal(item)" @input="setOtVal(item, $event.target.value)" />
              </div>
            </template>

            <div v-else-if="f.type === 'icon'" class="icon-field">
              <button class="icon-pick-btn" @click="togglePicker(section.key, idx)">
                <IconSvg :file="item.icon" color="#fff" :height="18" />
              </button>
              <div
                v-if="pickerFor === section.key + ':' + idx"
                class="picker-backdrop"
                @click="pickerFor = null"
              ></div>
              <div v-if="pickerFor === section.key + ':' + idx" class="icon-picker">
                <div class="picker-grid">
                  <div
                    v-for="ic in AVAILABLE_ICONS"
                    :key="ic"
                    class="picker-tile"
                    :class="{ selected: item.icon === ic }"
                    :title="ic.replace('.svg', '')"
                    @click="pickIcon(item, ic)"
                  >
                    <IconSvg :file="ic" color="#fff" :height="22" />
                  </div>
                  <div
                    v-for="name in customIconNames"
                    :key="'custom:' + name"
                    class="picker-tile"
                    :class="{ selected: item.icon === 'custom:' + name }"
                    :title="name"
                    @click="pickIcon(item, 'custom:' + name)"
                  >
                    <IconSvg :file="'custom:' + name" color="#fff" :height="22" />
                    <span class="tile-del" title="Delete this custom icon" @click.stop="removeIcon(name)">✕</span>
                  </div>
                  <label class="picker-tile upload" title="Upload SVG">
                    +
                    <input type="file" accept=".svg,image/svg+xml" hidden @change="uploadIcon($event, item)" />
                  </label>
                </div>
              </div>
            </div>

            <input
              v-else-if="f.type === 'color'"
              type="color"
              :value="item[f.key] || '#ffffff'"
              @input="item[f.key] = $event.target.value"
            />

            <input
              v-else-if="f.type === 'number'"
              type="number"
              :step="f.step || 1"
              :value="numVal(item, f)"
              @input="setNum(item, f, $event.target.value)"
            />

            <input
              v-else
              type="text"
              :value="item[f.key] || ''"
              @input="item[f.key] = $event.target.value"
            />
          </div>

          <span class="remove-btn" @click="removeItem(section.key, idx)">✕</span>
        </div>
      </div>
    </div>

  </div>
</template>
