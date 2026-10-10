'use strict'

// These literals are stamped from the exact generated release, never a
// runtime directory scan. Artwork is stored separately in IndexedDB.
const RELEASE = __RELEASE__
const PRECACHE = __PRECACHE__
const ROOT = self.registration.scope
const CACHE_PREFIX = 'dotgrid-shell-' + encodeURIComponent(new URL(ROOT).pathname) + '-'
const CACHE_NAME = CACHE_PREFIX + RELEASE
const MIME = { javascript: ['text/javascript', 'application/javascript'], manifest: ['application/manifest+json', 'application/json'] }
const requests = new Map()
let previousReleases = null

async function validResponse (response, entry) {
  if (!response || response.status !== 200 || response.redirected) throw new Error('Missing application resource: ' + entry.url)
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!(MIME[entry.type] || [entry.type]).includes(type)) throw new Error('Incorrect application resource type: ' + entry.url)
  const bytes = await response.clone().arrayBuffer()
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== entry.sha256) throw new Error('Application resource belongs to another release: ' + entry.url)
  return response
}

async function fillCache () {
  // Fetch and verify the complete set before changing any existing shell
  // cache. A failed repair also keeps every still-usable cached response.
  const controller = new AbortController()
  let timer
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('The app download timed out. Reconnect and retry cache repair.'))
      controller.abort()
    }, 15000)
  })
  let responses
  try {
    // Race the whole response verification, including body reads and hashing.
    // Aborting fetch alone cannot cancel a stalled digest promise.
    responses = await Promise.race([
      Promise.all(PRECACHE.map(async entry => validResponse(await fetch(new URL(entry.url, ROOT), { cache: 'reload', credentials: 'same-origin', signal: controller.signal }), entry))),
      deadline
    ])
  } catch (error) {
    controller.abort()
    throw error
  } finally {
    clearTimeout(timer)
  }
  const cache = await caches.open(CACHE_NAME)
  for (let i = 0; i < PRECACHE.length; i++) await cache.put(new URL(PRECACHE[i].url, ROOT), responses[i])
  return verifyCache()
}

async function verifyCache () {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(PRECACHE.map(async entry => validResponse(await cache.match(new URL(entry.url, ROOT)), entry)))
  return { ok: true, release: RELEASE, complete: true }
}

self.addEventListener('install', event => {
  event.waitUntil(fillCache().catch(async error => {
    await caches.delete(CACHE_NAME)
    throw error
  }))
  // Never skipWaiting during install. Existing editors choose activation.
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await verifyCache()
    await self.clients.claim()
    // A coordinated update tells us which preceding releases are in use.
    // Without that proof, retain old shells conservatively.
    if (previousReleases) {
      const retain = new Set([CACHE_NAME, ...[...previousReleases].map(release => CACHE_PREFIX + release)])
      for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && !retain.has(name)) await caches.delete(name)
    } else if (!(await editorClients()).length) {
      // The browser may naturally activate after every editor has closed.
      // CacheStorage preserves creation order; retain the last older shell.
      const names = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      for (const name of names.slice(0, -1)) await caches.delete(name)
    }
  })())
})

async function editorClients () {
  // Include newly opened, not-yet-controlled windows: an unresponsive editor
  // also defers activation instead of slipping through a coordination race.
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(ROOT))
}

function releasePeers (request) {
  for (const peer of request.peers) peer.postMessage({ type: 'DOTGRID_UPDATE_RELEASE', requestId: request.id })
}

async function activateSafely (event) {
  const port = event.ports[0]
  if (!port || !event.source || requests.size) { if (port) port.postMessage({ ok: false, reason: 'Another update check is in progress. Retry later.' }); return }
  const peers = await editorClients()
  if (!peers.length || !peers.some(peer => peer.id === event.source.id)) { port.postMessage({ ok: false, reason: 'The current editor could not be coordinated. Retry later.' }); return }
  const request = { id: event.data.requestId, peers, replies: new Map(), cancelled: false, wake: null }
  requests.set(request.id, request)
  const finished = new Promise(resolve => { request.wake = resolve })
  const timer = setTimeout(() => request.wake(), 8000)
  try {
    for (const peer of peers) peer.postMessage({ type: 'DOTGRID_UPDATE_PREPARE', requestId: request.id })
    await finished
    if (request.cancelled || request.replies.size !== peers.length || [...request.replies.values()].some(reply => !reply.safe)) throw new Error('Another editor has unsaved work, pending construction, or did not respond. Finish or close it, then retry.')
    const now = await editorClients()
    if (now.length !== peers.length || now.some(peer => !request.replies.has(peer.id))) throw new Error('Another editor opened during the update. Finish or close it, then retry.')
    if (request.cancelled) throw new Error('The update was postponed. Retry later.')
    await verifyCache()
    if (request.cancelled) throw new Error('The update was postponed. Retry later.')
    // No asynchronous gap between the final client inventory and activation.
    const finalPeers = await editorClients()
    if (finalPeers.length !== peers.length || finalPeers.some(peer => !request.replies.has(peer.id))) throw new Error('Another editor opened during the update. Retry later.')
    if (request.cancelled) throw new Error('The update was postponed. Retry later.')
    previousReleases = new Set([...request.replies.values()].map(reply => reply.release).filter(release => release && release !== RELEASE))
    await self.skipWaiting()
    port.postMessage({ ok: true, release: RELEASE })
  } catch (error) {
    releasePeers(request)
    port.postMessage({ ok: false, reason: error.message })
  } finally {
    clearTimeout(timer)
    requests.delete(request.id)
  }
}

self.addEventListener('message', event => {
  const message = event.data || {}
  if (message.type === 'DOTGRID_UPDATE_ACK') {
    const request = requests.get(message.requestId)
    if (request && event.source && request.peers.some(peer => peer.id === event.source.id)) {
      request.replies.set(event.source.id, { safe: message.safe === true, release: message.release })
      if (!message.safe || request.replies.size === request.peers.length) request.wake()
    }
    return
  }
  if (message.type === 'DOTGRID_UPDATE_ABORT') {
    const request = requests.get(message.requestId)
    if (request && event.source && request.peers.some(peer => peer.id === event.source.id)) { request.cancelled = true; request.wake() }
    return
  }
  if (message.type === 'DOTGRID_UPDATE_ACTIVATE') { event.waitUntil(activateSafely(event)); return }
  const action = message.type === 'DOTGRID_VERIFY_CACHE' ? verifyCache : message.type === 'DOTGRID_REPAIR_CACHE' ? fillCache : null
  if (action && event.ports[0]) event.waitUntil(action().then(result => event.ports[0].postMessage(result)).catch(error => event.ports[0].postMessage({ ok: false, complete: false, reason: error.message })))
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || !url.href.startsWith(ROOT)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const path = url.href.slice(ROOT.length).split('?')[0]
    const entry = path === '' || path === 'index.html' ? 'index.html' : PRECACHE.some(item => item.url === path) ? path : null
    if (entry) {
      const cached = await cache.match(new URL(entry, ROOT))
      if (cached) return cached
    }
    // An old, already-running editor can finish loading its hashed resource.
    if (/^app\.[a-f\d]+\.(?:js|css)$/.test(path)) {
      for (const name of await caches.keys()) {
        if (!name.startsWith(CACHE_PREFIX) || name === CACHE_NAME) continue
        const cached = await (await caches.open(name)).match(new URL(path, ROOT))
        if (cached) return cached
      }
    }
    try { return await fetch(request) } catch (error) {
      if (request.mode === 'navigate') {
        const fallback = await cache.match(new URL('404.html', ROOT))
        if (fallback) return new Response(await fallback.text(), { status: 404, headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('Application resource unavailable. Reconnect to repair the shell cache.', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    }
  })())
})
