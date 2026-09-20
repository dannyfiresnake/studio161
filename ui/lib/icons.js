// Fetch an SVG icon and recolor it, returning markup ready to inject.
// Built-in icons are files under /icons on the local server. Custom icons
// live in the cloud worker's icon library ("custom:<name>"), fetched with
// auth and cached in localStorage so they still render offline.
import { ref } from 'vue'
import { fetchCloud } from '../cloud.js'

const rawCache = {} // in-memory, per session (built-in and custom)

// Names of the custom icons in the cloud library (for the settings picker).
export const customIconList = ref([])
let listLoaded = false

export async function loadCustomIconList(force = false) {
  if (listLoaded && !force) return
  try {
    const resp = await fetchCloud('icons')
    if (resp.ok) {
      customIconList.value = await resp.json()
      listLoaded = true
    }
  } catch {
    // Offline: fall back to whatever this device has cached.
    customIconList.value = Object.keys(localStorage)
      .filter((k) => k.startsWith('iconCache:'))
      .map((k) => k.slice(10))
  }
}

export async function uploadCustomIcon(name, svg) {
  const resp = await fetchCloud('icons/' + name, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/svg+xml' },
    body: svg,
  })
  if (!resp.ok) throw new Error(await resp.text())
  rawCache['custom:' + name] = svg
  localStorage.setItem('iconCache:' + name, svg)
  if (!customIconList.value.includes(name)) customIconList.value.push(name)
}

export async function deleteCustomIcon(name) {
  const resp = await fetchCloud('icons/' + name, { method: 'DELETE' })
  if (!resp.ok) throw new Error(await resp.text())
  delete rawCache['custom:' + name]
  localStorage.removeItem('iconCache:' + name)
  customIconList.value = customIconList.value.filter((n) => n !== name)
}

async function svgSource(file) {
  if (rawCache[file]) return rawCache[file]
  if (file.startsWith('custom:')) {
    const name = file.slice(7)
    try {
      const resp = await fetchCloud('icons/' + name)
      if (resp.ok) {
        const svg = await resp.text()
        rawCache[file] = svg
        localStorage.setItem('iconCache:' + name, svg)
        return svg
      }
    } catch {
      // Offline: use the last cached copy.
    }
    return localStorage.getItem('iconCache:' + name) || ''
  }
  const resp = await fetch('/icons/' + file)
  rawCache[file] = await resp.text()
  return rawCache[file]
}

export async function coloredSvg(file, color, height) {
  const src = await svgSource(file)
  if (!src) return ''
  const div = document.createElement('div')
  div.innerHTML = src
  const svg = div.querySelector('svg')
  if (!svg) return ''
  svg.style.height = height + 'px'
  svg.style.width = 'auto'
  svg.setAttribute('fill', color)
  svg.querySelectorAll('path,rect,circle,polygon,ellipse').forEach((el) => {
    if (el.getAttribute('fill') && el.getAttribute('fill') !== 'none') el.setAttribute('fill', color)
    if (!el.getAttribute('fill')) el.setAttribute('fill', color)
  })
  return svg.outerHTML
}
