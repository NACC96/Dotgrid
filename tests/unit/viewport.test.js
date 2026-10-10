const test = require('node:test')
const assert = require('node:assert/strict')
const Viewport = require('../../scripts/viewport.js')
const samePoint = (a, b) => { assert.ok(Math.abs(a.x - b.x) < 1e-9); assert.ok(Math.abs(a.y - b.y) < 1e-9) }
test('inverse mapping and zoom preserve the point under the fingers', () => {
  const view = new Viewport()
  view.fit({ width: 600, height: 300 }, 900, 600)
  const p = { x: 90, y: 45 }
  const screen = view.toScreen(p)
  samePoint(view.toDocument(screen), p)
  view.zoomAt(view.scale * 2, screen)
  samePoint(view.toDocument(screen), p)
})
test('resizing changes the view while preserving model coordinates', () => {
  const view = new Viewport()
  view.fit({ width: 600, height: 300 }, 900, 600)
  const center = view.toDocument({ x: 450, y: 300 })
  view.resize(600, 900)
  samePoint(view.toDocument({ x: 300, y: 450 }), center)
  const signed = { x: -15, y: 90 }
  samePoint(view.toDocument(view.toScreen(signed)), signed)
})
