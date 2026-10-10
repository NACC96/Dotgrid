const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { GridDocument } = require('../../scripts/document.js')
const { Manager } = require('../../scripts/manager.js')
const fixture = () => JSON.parse(fs.readFileSync('tests/fixtures/legacy-signed.grid', 'utf8'))

test('grid and SVG prepare fresh typed files from document dimensions and painter order', async () => {
  const document = new GridDocument(fixture())
  const client = { document, projectName: 'Signed drawing', viewport: { zoom: 99 } }
  const manager = new Manager(client)
  const grid = await manager.prepare('grid')
  assert.equal(grid.name, 'Signed drawing.grid')
  assert.equal(grid.type, 'application/json')
  assert.equal(JSON.parse(await grid.text()).layers[0][0].vertices[0].x, -15)
  document.edit('size and paint', d => {
    d.settings.size = { width: 800, height: 400 }
    d.styles[0].color = '#123456'
    d.layers[2] = [{ type: 'line', vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }]
  })
  const svg = await manager.prepare('svg')
  const xml = await svg.text()
  assert.equal(svg.type, 'image/svg+xml')
  assert.match(xml, /viewBox="0 0 800 400"/)
  assert.match(xml, /width="800" height="400"/)
  assert.match(xml, /overflow="hidden"/)
  assert.match(xml, /stroke="#123456"/)
  assert.ok(xml.indexOf('data-layer="2"') < xml.indexOf('data-layer="1"'))
  assert.ok(xml.indexOf('data-layer="1"') < xml.indexOf('data-layer="0"'))
  assert.match(xml, /M-15,15/)
  assert.doesNotMatch(xml, /selection|ruler|viewport|zoom/)
})

test('SVG escapes project titles and retained metadata as text', () => {
  const data = fixture()
  data.author = '<script>alert("x")</script> & notes'
  const manager = new Manager({ document: new GridDocument(data), projectName: 'A < B & "C"' })
  const svg = manager.toString()
  assert.match(svg, /<title>A &lt; B &amp; &quot;C&quot;<\/title>/)
  assert.match(svg, /&lt;script&gt;/)
  assert.doesNotMatch(svg, /<script>/)
})

test('PNG rejects oversized allocation before making a canvas and remains exportable as grid', async () => {
  const data = fixture()
  data.settings.width = 10000
  data.settings.height = 10000
  const manager = new Manager({ document: new GridDocument(data) })
  await assert.rejects(manager.prepare('png'), error => error.code === 'RASTER_LIMIT')
  assert.equal((await manager.prepare('grid')).name, 'Drawing.grid')
})

test('PNG paints artwork directly with transparent background and releases the canvas after encoding', async () => {
  const originalDocument = globalThis.document
  const originalPath = globalThis.Path2D
  const calls = []
  const context = {
    scale: (...args) => calls.push(['scale', ...args]),
    beginPath: () => calls.push(['beginPath']),
    rect: (...args) => calls.push(['bounds', ...args]),
    clip: () => calls.push(['clip']),
    fill: path => calls.push(['fill', path.d]),
    stroke: path => calls.push(['stroke', path.d])
  }
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: callback => callback(new Blob(['png bytes'], { type: 'image/png' })) }
  globalThis.document = { createElement: type => { assert.equal(type, 'canvas'); calls.push(['canvas']); return canvas } }
  globalThis.Path2D = class { constructor (d) { this.d = d } }
  try {
    const data = fixture()
    data.styles[0].fill = '#123456'
    const manager = new Manager({ document: new GridDocument(data), projectName: 'Drawing' })
    const file = await manager.prepare('png')
    assert.equal(file.name, 'Drawing.png')
    assert.equal(file.type, 'image/png')
    assert.deepEqual(calls[1], ['scale', 2, 2])
    assert.ok(calls.some(c => c[0] === 'bounds' && c[3] === 600 && c[4] === 300))
    assert.equal(calls.filter(c => c[0] === 'stroke').length, 3)
    assert.equal(calls.filter(c => c[0] === 'fill').length, 1)
    assert.equal(canvas.width, 0)
    assert.equal(canvas.height, 0)
    assert.equal(context.strokeStyle, '#1b2530')
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalPath === undefined) delete globalThis.Path2D
    else globalThis.Path2D = originalPath
  }
})
