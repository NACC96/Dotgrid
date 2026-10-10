const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { ProjectLibrary } = require('../../scripts/projects.js')
const { Source } = require('../../scripts/lib/source.js')
const fixture = () => JSON.parse(fs.readFileSync('tests/fixtures/legacy-signed.grid', 'utf8'))

test('legacy signed geometry and harmless metadata round-trip without mutating input', () => {
  const original = fixture()
  original.author = { name: '<Artist & friends>', notes: 'keep me' }
  original.layers[0][0].tag = 'off canvas'
  const data = ProjectLibrary.validate(original)
  assert.deepEqual(data.settings.size, { width: 600, height: 300 })
  assert.equal(data.settings.guide, 'retained metadata')
  assert.equal(data.layers[0][0].vertices[0].x, -15)
  assert.deepEqual(data.author, original.author)
  data.layers[0][0].vertices[0].x = 99
  assert.equal(original.layers[0][0].vertices[0].x, -15)
  assert.equal(original.settings.size, undefined)
})

test('validation accepts accumulated legacy quadratic arrays independently of toolbar canCast', () => {
  const data = fixture()
  data.layers[0] = [{ type: 'bezier', vertices: [{ x: 0, y: 0 }, { x: 15, y: 30 }, { x: 30, y: 0 }, { x: 30, y: 0 }, { x: 45, y: 30 }, { x: 60, y: 0 }] }]
  assert.equal(ProjectLibrary.validate(data).layers[0][0].vertices.length, 6)
  for (const name of ['benchmark-small', 'benchmark-standard', 'benchmark-stress']) {
    assert.equal(ProjectLibrary.validate(fs.readFileSync(`tests/fixtures/${name}.grid`, 'utf8')).layers.length, 3)
  }
})

test('malformed geometry, styles, unsupported schema and resource ceilings reject instead of truncating', () => {
  const cases = [
    d => { d.layers[0][0].type = 'script' },
    d => { d.layers[0][0].vertices[0].x = Infinity },
    d => { d.layers[0][0].vertices = [{ x: 0, y: 0 }] },
    d => { d.layers.pop() },
    d => { d.styles[0].strokeLinecap = 'square\" onload=\"bad' },
    d => { d.styles[0].fill = 'url(https://example.test/paint)' },
    d => { d.styles[0].color = 'rgb()' },
    d => { d.styles[0].color = 'rgb(1e999, 0, 0)' },
    d => { d.settings.width = 10001 },
    d => { d.schemaVersion = 2 },
    d => { d.layers[0][0].vertices = Array.from({ length: ProjectLibrary.LIMITS.maxVertices + 1 }, () => ({ x: 0, y: 0 })) }
  ]
  for (const mutate of cases) {
    const data = fixture()
    mutate(data)
    assert.throws(() => ProjectLibrary.validate(data), error => typeof error.code === 'string')
  }
  assert.throws(() => ProjectLibrary.validate('{broken'), /JSON/)
  assert.throws(() => ProjectLibrary.validate(' '.repeat(ProjectLibrary.LIMITS.maxJsonBytes + 1)), error => error.code === 'RESOURCE_LIMIT')
})

test('supported local CSS paints preserve numeric colors and normalize harmless whitespace', () => {
  for (const paint of ['rgb(12, 34, 56)', 'rgba(12, 34, 56, .5)', 'rgb(12 34 56 / 50%)', 'hsl(120deg 50% 40%)', 'hwb(120 20% 30%)', 'oklch(50% .2 120)', 'RebeccaPurple', '#1234']) {
    const data = fixture()
    data.styles[0].color = paint
    data.styles[0].fill = ' none '
    const valid = ProjectLibrary.validate(data)
    assert.equal(valid.styles[0].color, paint)
    assert.equal(valid.styles[0].fill, 'none')
  }
})

test('FileReader fallback validates before calling an import callback', async () => {
  const original = globalThis.FileReader
  globalThis.FileReader = class {
    readAsText (file) { this.result = file.content; this.onload() }
  }
  try {
    const source = new Source()
    const callbacks = []
    const valid = { size: 10, name: 'legacy.grid', content: JSON.stringify(fixture()) }
    assert.equal((await source.read(valid, (file, text) => callbacks.push([file.name, JSON.parse(text)]))).settings.size.width, 600)
    await assert.rejects(source.read({ size: 3, content: 'bad' }, () => callbacks.push('invalid')), /JSON/)
    assert.equal(callbacks.length, 1)
  } finally {
    if (original === undefined) delete globalThis.FileReader
    else globalThis.FileReader = original
  }
})

test('downloads retain Blob URLs through handoff and release them afterwards', () => {
  const originalDocument = globalThis.document
  const originalSetTimeout = globalThis.setTimeout
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const revoked = []
  let release
  let removed = false
  let clicked = false
  const link = { click: () => { clicked = true; assert.equal(revoked.length, 0) }, remove: () => { removed = true } }
  URL.createObjectURL = () => 'blob:prepared'
  URL.revokeObjectURL = url => revoked.push(url)
  globalThis.document = { createElement: () => link, body: { appendChild: () => {} } }
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 60000); release = callback; return 1 }
  try {
    const file = new File(['backup'], 'Signed.grid', { type: 'application/json' })
    assert.equal(new Source().download(file), 'blob:prepared')
    assert.equal(link.download, 'Signed.grid')
    assert.equal(clicked, true)
    assert.equal(removed, true)
    assert.deepEqual(revoked, [])
    release()
    assert.deepEqual(revoked, ['blob:prepared'])
  } finally {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    globalThis.setTimeout = originalSetTimeout
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('File reading validates before resolving and cancellation is a normal no-op', async () => {
  const source = new Source()
  const file = new File([JSON.stringify(fixture())], 'drawing.grid', { type: 'application/json' })
  assert.equal((await source.read(file)).layers[0][0].vertices[0].x, -15)
  await assert.rejects(source.read(new File(['bad'], 'drawing.grid')), /JSON/)
  assert.equal(await source.read(null), null)
  await assert.rejects(source.read({ size: ProjectLibrary.LIMITS.maxJsonBytes + 1, text: async () => { throw new Error('must not read') } }), error => error.code === 'RESOURCE_LIMIT')
})

test('Share is separate from preparation, and unavailable sharing or cancellation preserves a prepared file', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let shareCalls = 0
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    canShare: ({ files }) => files.length === 1,
    share: async () => { shareCalls++; throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) }
  } })
  try {
    const file = new File(['drawing'], 'Drawing.grid', { type: 'application/json' })
    const source = new Source()
    assert.equal(source.canShare(file), true)
    assert.equal(shareCalls, 0)
    assert.equal(await source.share(file), false)
    assert.equal(shareCalls, 1)
    assert.equal(await file.text(), 'drawing')
    globalThis.navigator.canShare = () => false
    assert.equal(source.canShare(file), false)
    await assert.rejects(source.share(file), error => error.code === 'SHARE_UNAVAILABLE')
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
})
