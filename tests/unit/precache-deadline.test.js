'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'public/service-worker.js'), 'utf8').replace('__RELEASE__', JSON.stringify('deadline-test')).replace('__PRECACHE__', JSON.stringify([{ url: 'index.html', type: 'text/html', sha256: '00'.repeat(32) }]))
for (const phase of ['install', 'repair']) for (const stall of ['request', 'response body', 'digest']) test(`${phase} aborts a stalled ${stall} without changing a usable shell`, async () => {
  const handlers = new Map()
  const deadlines = []
  const cleared = []
  const deleted = []
  let cacheWrites = 0
  let operation
  let fetchStarted
  let fetchSignal
  let finishDigest
  const started = new Promise(resolve => { fetchStarted = resolve })
  const neverUntilAbort = signal => new Promise((resolve, reject) => { if (signal) signal.addEventListener('abort', () => reject(new Error('Fixture aborted')), { once: true }) })
  vm.runInNewContext(source, {
    self: { registration: { scope: 'https://deadline.test/' }, addEventListener: (type, handler) => handlers.set(type, handler) },
    URL, Map, Set, AbortController,
    setTimeout: (callback, delay) => { const timer = { callback, delay }; deadlines.push(timer); return timer },
    clearTimeout: timer => cleared.push(timer),
    crypto: { subtle: { digest: () => { fetchStarted(); return new Promise(resolve => { finishDigest = resolve }) } } },
    fetch: async (url, options) => {
      fetchSignal = options.signal
      if (stall === 'request') { fetchStarted(); return neverUntilAbort(options.signal) }
      return { status: 200, redirected: false, headers: { get: () => 'text/html' }, clone: () => ({ arrayBuffer: () => {
        if (stall === 'digest') return Promise.resolve(new ArrayBuffer(0))
        fetchStarted(); return neverUntilAbort(options.signal)
      } }) }
    },
    caches: { open: async () => ({ put: async () => cacheWrites++ }), delete: async name => deleted.push(name) }
  })
  const replies = []
  const event = { data: { type: 'DOTGRID_REPAIR_CACHE' }, ports: [{ postMessage: reply => replies.push(reply) }], waitUntil: promise => { operation = promise } }
  handlers.get(phase === 'install' ? 'install' : 'message')(event)
  await started
  assert.equal(deadlines.length, 1)
  assert.ok(deadlines[0].delay > 0 && deadlines[0].delay < 30000)
  deadlines[0].callback()
  if (phase === 'install') await assert.rejects(operation, /timed out.*retry/i)
  else { await operation; assert.equal(replies[0].ok, false); assert.match(replies[0].reason, /timed out.*retry/i); assert.equal(deleted.length, 0) }
  assert.equal(fetchSignal.aborted, true)
  if (stall === 'digest') {
    // Digests cannot be aborted; completing one after the deadline must not
    // let the already-failed install or repair resume cache writes.
    finishDigest(new ArrayBuffer(32))
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(cacheWrites, 0)
  assert.deepEqual(cleared, deadlines)
})
