// Settings sync endpoint for studio161web.
//
// The cloud stores an undo stack: the last MAX_STATES saved configs plus an
// `active` pointer. Saving appends a state (dropping any redo tail); undo and
// redo move the pointer. Devices poll `version` (bumped on every mutation,
// including pointer moves) and pull the active state.
//
// KV keys:
//   history  {states: [{v, cfg}], active, version}  (cfg is a JSON string)
//   version  bare ISO timestamp of the last mutation (cheap polling)
//
// A custom icon library lives beside the config as `icon:<name>` keys — these
// are shared assets, not config state, so they are not versioned in history.
//
// Routes (all Basic-auth against the USERNAME/PASSWORD secrets):
//   GET  /              -> active config; X-Config-Version/X-Active/X-Length headers
//   GET  /version       -> {"version": "..."}
//   GET  /history       -> {version, active, states: [{v}]} (no configs; for tooling)
//   PUT  /              -> append a new state; {ok, version, active, length}
//   POST /undo          -> move pointer back;  {ok, version, active, length, config}
//   POST /redo          -> move pointer ahead; {ok, version, active, length, config}
//   GET  /icons         -> ["name", ...]
//   GET  /icons/<name>  -> SVG source
//   PUT  /icons/<name>  -> store an SVG
//   DELETE /icons/<name> -> remove it

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Expose-Headers': 'X-Config-Version, X-Active, X-Length',
}

const MAX_BODY_BYTES = 1_000_000
const MAX_ICON_BYTES = 200_000
const MAX_STATES = 100
const ICON_NAME = /^[A-Za-z0-9_-]{1,64}$/

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })

function timingSafeEqual(a, b) {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  return crypto.subtle.timingSafeEqual(ab, bb)
}

async function loadHistory(env) {
  const raw = await env.SETTINGS.get('history')
  if (raw) return JSON.parse(raw)
  // Migrate from the pre-history schema (single `config` key), preserving the
  // old config as the first undoable state.
  const cfg = await env.SETTINGS.get('config')
  if (cfg !== null) {
    const v = (await env.SETTINGS.get('version')) || new Date().toISOString()
    return { states: [{ v, cfg }], active: 0, version: v }
  }
  return { states: [], active: -1, version: '' }
}

async function saveHistory(env, hist) {
  await env.SETTINGS.put('history', JSON.stringify(hist))
  await env.SETTINGS.put('version', hist.version)
}

const posInfo = (hist) => ({ version: hist.version, active: hist.active, length: hist.states.length })

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const auth = req.headers.get('Authorization') || ''
    const expected = 'Basic ' + btoa(`${env.USERNAME}:${env.PASSWORD}`)
    if (!env.USERNAME || !env.PASSWORD || !timingSafeEqual(auth, expected)) {
      return new Response('unauthorized', { status: 401, headers: CORS })
    }

    const path = new URL(req.url).pathname

    // ── Icon library ──
    if (path === '/icons' && req.method === 'GET') {
      const list = await env.SETTINGS.list({ prefix: 'icon:' })
      return json(list.keys.map((k) => k.name.slice(5)))
    }
    const iconMatch = path.match(/^\/icons\/(.+)$/)
    if (iconMatch) {
      const name = iconMatch[1]
      if (!ICON_NAME.test(name)) {
        return new Response('bad icon name', { status: 400, headers: CORS })
      }
      if (req.method === 'GET') {
        const svg = await env.SETTINGS.get('icon:' + name)
        if (svg === null) return new Response('not found', { status: 404, headers: CORS })
        return new Response(svg, {
          headers: { 'Content-Type': 'image/svg+xml', ...CORS },
        })
      }
      if (req.method === 'PUT') {
        const body = await req.text()
        if (body.length > MAX_ICON_BYTES) {
          return new Response('too large', { status: 413, headers: CORS })
        }
        if (!body.includes('<svg')) {
          return new Response('not an SVG', { status: 400, headers: CORS })
        }
        await env.SETTINGS.put('icon:' + name, body)
        return json({ ok: true })
      }
      if (req.method === 'DELETE') {
        await env.SETTINGS.delete('icon:' + name)
        return json({ ok: true })
      }
      return new Response('method not allowed', { status: 405, headers: CORS })
    }

    if (req.method === 'GET') {
      if (path === '/version') {
        const version = await env.SETTINGS.get('version')
        return json({ version })
      }

      const hist = await loadHistory(env)

      if (path === '/history') {
        return json({ ...posInfo(hist), states: hist.states.map((s) => ({ v: s.v })) })
      }

      if (hist.active < 0) {
        return new Response('not found', { status: 404, headers: CORS })
      }
      return new Response(hist.states[hist.active].cfg, {
        headers: {
          'Content-Type': 'application/json',
          'X-Config-Version': hist.version,
          'X-Active': String(hist.active),
          'X-Length': String(hist.states.length),
          ...CORS,
        },
      })
    }

    if (req.method === 'PUT') {
      const body = await req.text()
      if (body.length > MAX_BODY_BYTES) {
        return new Response('too large', { status: 413, headers: CORS })
      }
      try {
        JSON.parse(body)
      } catch {
        return new Response('invalid JSON', { status: 400, headers: CORS })
      }
      const hist = await loadHistory(env)
      hist.states = hist.states.slice(0, hist.active + 1) // drop any redo tail
      hist.states.push({ v: new Date().toISOString(), cfg: body })
      if (hist.states.length > MAX_STATES) {
        hist.states = hist.states.slice(hist.states.length - MAX_STATES)
      }
      hist.active = hist.states.length - 1
      hist.version = hist.states[hist.active].v
      await saveHistory(env, hist)
      return json({ ok: true, ...posInfo(hist) })
    }

    if (req.method === 'POST' && (path === '/undo' || path === '/redo')) {
      const hist = await loadHistory(env)
      const target = hist.active + (path === '/undo' ? -1 : 1)
      if (target < 0 || target >= hist.states.length) {
        return json({ ok: false, error: 'nothing to ' + path.slice(1), ...posInfo(hist) }, 409)
      }
      hist.active = target
      hist.version = new Date().toISOString()
      await saveHistory(env, hist)
      return json({ ok: true, ...posInfo(hist), config: JSON.parse(hist.states[target].cfg) })
    }

    return new Response('method not allowed', { status: 405, headers: CORS })
  },
}
