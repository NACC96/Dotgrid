const test = require('node:test')
const assert = require('node:assert/strict')
const Viewport = require('../../scripts/viewport.js')
const InputController = require('../../scripts/input.js')

class Canvas {
  constructor () {
    this.style = {}
    this.listeners = new Map()
    this.captured = new Set()
    this.released = []
    this.rect = { left: 20, top: 40, width: 500, height: 300 }
  }

  addEventListener (type, listener, options) {
    this.listeners.set(type, { listener, options })
  }

  getBoundingClientRect () { return this.rect }
  setPointerCapture (id) { this.captured.add(id) }
  hasPointerCapture (id) { return this.captured.has(id) }
  releasePointerCapture (id) {
    this.captured.delete(id)
    this.released.push(id)
    this.emit('lostpointercapture', { pointerId: id })
  }

  emit (type, values = {}) {
    const event = {
      pointerId: 1,
      pointerType: 'pen',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: 120,
      clientY: 140,
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      defaultPrevented: false,
      preventDefault () { this.defaultPrevented = true },
      ...values
    }
    this.listeners.get(type)?.listener(event)
    return event
  }
}

function setup (options = {}) {
  const canvas = new Canvas()
  const viewport = new Viewport()
  viewport.width = 500
  viewport.height = 300
  const calls = []
  const record = kind => (point, event) => {
    calls.push({ kind, point, event })
    return true
  }
  const input = new InputController(canvas, {
    viewport,
    onBegin: record('begin'),
    onMove: record('move'),
    onEnd: record('end'),
    onCancel: record('cancel'),
    onHover: record('hover'),
    onViewChange: () => calls.push({ kind: 'view' }),
    ...options
  })
  return { canvas, viewport, input, calls }
}

const kinds = calls => calls.map(call => call.kind)
const touch = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x + 20, clientY: y + 40 })
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

test('canvas policy is established before contact without compatibility mouse listeners', () => {
  const { canvas, calls } = setup()
  assert.equal(canvas.style.touchAction, 'none')
  assert.equal(canvas.listeners.get('wheel').options.passive, false)
  assert.equal(canvas.listeners.has('mousedown'), false)
  assert.equal(canvas.listeners.has('mouseup'), false)
  const toolbar = new Canvas()
  toolbar.emit('pointerdown')
  canvas.emit('mousedown')
  canvas.emit('mouseup')
  assert.deepEqual(calls, [])
})

test('rapid Pencil taps each finish once with canvas-relative coordinates', () => {
  const { canvas, input, calls } = setup()
  for (let id = 1; id <= 3; id++) {
    const down = canvas.emit('pointerdown', { pointerId: id })
    assert.equal(down.defaultPrevented, true)
    assert.equal(canvas.captured.has(id), true)
    assert.equal(input.active, true)
    canvas.emit('pointerup', { pointerId: id })
    canvas.emit('pointerup', { pointerId: id })
    assert.equal(input.active, false)
  }
  assert.deepEqual(kinds(calls), ['begin', 'end', 'begin', 'end', 'begin', 'end'])
  for (const call of calls) assert.deepEqual(call.point, { x: 100, y: 100 })
  assert.deepEqual(canvas.released, [1, 2, 3])
})

test('captured mouse drag can release outside the canvas exactly once', () => {
  const { canvas, input, calls } = setup()
  canvas.emit('pointerdown', { pointerType: 'mouse' })
  canvas.emit('pointermove', { pointerType: 'mouse', clientX: 600, clientY: 450 })
  canvas.emit('pointerup', { pointerType: 'mouse', clientX: 620, clientY: 460 })
  canvas.emit('lostpointercapture')
  assert.deepEqual(kinds(calls), ['begin', 'move', 'end'])
  assert.deepEqual(calls.at(-1).point, { x: 600, y: 420 })
  assert.equal(input.active, false)
})

test('nonprimary mouse buttons and rejected editing targets never own an edit', () => {
  const rejected = setup({ onBegin: () => false })
  rejected.canvas.emit('pointerdown')
  rejected.canvas.emit('pointermove')
  rejected.canvas.emit('pointerup')
  assert.deepEqual(rejected.calls, [])
  const { canvas, calls } = setup()
  canvas.emit('pointerdown', { pointerType: 'mouse', button: 2 })
  canvas.emit('pointerup', { pointerType: 'mouse', button: 2 })
  assert.deepEqual(calls, [])
})

for (const interruption of ['pointercancel', 'lostpointercapture']) {
  test(`${interruption} rolls back one preview and cannot later finish it`, () => {
    const { canvas, input, calls } = setup()
    canvas.emit('pointerdown')
    canvas.emit('pointermove', { clientX: 150, clientY: 180 })
    canvas.emit(interruption)
    canvas.emit('pointerup')
    canvas.emit('lostpointercapture')
    assert.deepEqual(kinds(calls), ['begin', 'move', 'cancel'])
    assert.deepEqual(calls.at(-1).point, { x: 130, y: 140 })
    assert.equal(input.active, false)
  })
}

test('one finger is nonediting by default and two fingers pan and pinch from a stable origin', () => {
  const { canvas, viewport, input, calls } = setup()
  viewport.x = 40
  viewport.y = 30
  viewport.scale = 2
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointermove', touch(1, 100, 100))
  assert.deepEqual(calls, [])
  canvas.emit('pointerdown', touch(2, 200, 100))
  canvas.emit('pointermove', touch(1, 80, 120))
  canvas.emit('pointermove', touch(2, 240, 120))
  approximately(viewport.scale, 3.2)
  approximately(viewport.x, -16)
  approximately(viewport.y, 8)
  assert.ok(calls.every(call => call.kind === 'view'))
  canvas.emit('pointerup', touch(2, 240, 120))
  const transform = { x: viewport.x, y: viewport.y, scale: viewport.scale }
  canvas.emit('pointermove', touch(1, 120, 120))
  canvas.emit('pointerup', touch(1, 120, 120))
  assert.deepEqual({ x: viewport.x, y: viewport.y, scale: viewport.scale }, transform)
  assert.equal(input.active, false)
})

test('touch editing stays tentative until release and its second finger cancels before navigation', () => {
  const { canvas, input, calls } = setup()
  input.setTouchEditing(true)
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointermove', touch(1, 120, 100))
  assert.deepEqual(kinds(calls), ['begin', 'move'])
  canvas.emit('pointerdown', touch(2, 200, 100))
  assert.deepEqual(kinds(calls), ['begin', 'move', 'cancel'])
  canvas.emit('pointermove', touch(2, 220, 100))
  assert.equal(calls.at(-1).kind, 'view')
  canvas.emit('pointerup', touch(2, 220, 100))
  canvas.emit('pointerup', touch(1, 120, 100))
  assert.equal(kinds(calls).includes('end'), false)
  canvas.emit('pointerdown', touch(3, 100, 100))
  canvas.emit('pointerup', touch(3, 120, 100))
  assert.deepEqual(kinds(calls).slice(-2), ['begin', 'end'])
})

test('Pencil contact freezes finger navigation and wheel changes until ignored fingers lift', () => {
  const { canvas, viewport, calls } = setup()
  canvas.emit('pointerdown', { pointerId: 10 })
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointerdown', touch(2, 200, 100))
  canvas.emit('pointermove', touch(1, 50, 50))
  canvas.emit('wheel', { deltaY: 40, ctrlKey: true })
  assert.equal(viewport.scale, 1)
  assert.equal(viewport.x, 0)
  assert.deepEqual(kinds(calls), ['begin'])
  canvas.emit('pointerup', { pointerId: 10 })
  canvas.emit('pointermove', touch(2, 250, 150))
  canvas.emit('pointerup', touch(1, 50, 50))
  canvas.emit('pointerup', touch(2, 250, 150))
  assert.deepEqual(kinds(calls), ['begin', 'end'])
  assert.equal(viewport.scale, 1)
})

test('new fingers remain suppressed until all ignored Pencil-era contacts have lifted', () => {
  const { canvas, input, calls } = setup()
  input.setTouchEditing(true)
  canvas.emit('pointerdown', { pointerId: 10 })
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointerup', { pointerId: 10 })
  canvas.emit('pointerdown', touch(2, 200, 100))
  canvas.emit('pointermove', touch(2, 220, 100))
  canvas.emit('pointerup', touch(1, 100, 100))
  canvas.emit('pointerup', touch(2, 220, 100))
  assert.deepEqual(kinds(calls), ['begin', 'end'])
  canvas.emit('pointerdown', touch(3, 100, 100))
  canvas.emit('pointerup', touch(3, 100, 100))
  assert.deepEqual(kinds(calls).slice(-2), ['begin', 'end'])
})

test('a contact that cannot be captured never starts an edit or leaves ownership behind', () => {
  const { canvas, input, calls } = setup()
  canvas.setPointerCapture = () => { throw new Error('No active pointer') }
  assert.doesNotThrow(() => canvas.emit('pointerdown'))
  canvas.emit('pointerup')
  assert.equal(input.active, false)
  assert.deepEqual(calls, [])
})

test('Pencil replaces tentative touch editing and captures a fresh edit', () => {
  const { canvas, input, calls } = setup()
  input.setTouchEditing(true)
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointerdown', { pointerId: 10 })
  canvas.emit('pointermove', touch(1, 120, 100))
  canvas.emit('pointerup', touch(1, 120, 100))
  canvas.emit('pointerup', { pointerId: 10 })
  assert.deepEqual(kinds(calls), ['begin', 'cancel', 'begin', 'end'])
})

test('a third finger can replace a lifted navigation contact without jumping or editing', () => {
  const { canvas, viewport, input, calls } = setup()
  input.setTouchEditing(true)
  canvas.emit('pointerdown', touch(1, 100, 100))
  canvas.emit('pointerdown', touch(2, 200, 100))
  canvas.emit('pointermove', touch(2, 220, 100))
  canvas.emit('pointerdown', touch(3, 160, 200))
  const before = { x: viewport.x, y: viewport.y, scale: viewport.scale }
  canvas.emit('pointerup', touch(1, 100, 100))
  assert.deepEqual({ x: viewport.x, y: viewport.y, scale: viewport.scale }, before)
  canvas.emit('pointermove', touch(2, 240, 120))
  assert.notDeepEqual({ x: viewport.x, y: viewport.y, scale: viewport.scale }, before)
  canvas.emit('pointerup', touch(2, 240, 120))
  canvas.emit('pointerup', touch(3, 160, 200))
  assert.equal(kinds(calls).includes('end'), false)
})

test('cancelAll rolls back editing, releases captures and makes late releases harmless', () => {
  const { canvas, input, calls } = setup()
  canvas.emit('pointerdown', { pointerId: 10 })
  canvas.emit('pointerdown', touch(1, 100, 100))
  input.cancelAll()
  input.cancelAll()
  canvas.emit('pointerup', { pointerId: 10 })
  canvas.emit('pointerup', touch(1, 100, 100))
  assert.equal(input.active, false)
  assert.equal(canvas.captured.size, 0)
  assert.deepEqual(kinds(calls), ['begin', 'cancel'])
})

test('disabling touch editing cancels existing intent without reinterpreting its release', () => {
  const { canvas, input, calls } = setup()
  input.setTouchEditing(true)
  canvas.emit('pointerdown', touch(1, 100, 100))
  input.setTouchEditing(false)
  canvas.emit('pointerup', touch(1, 100, 100))
  assert.deepEqual(kinds(calls), ['begin', 'cancel'])
  canvas.emit('pointerdown', touch(2, 100, 100))
  input.setTouchEditing(true)
  canvas.emit('pointerup', touch(2, 100, 100))
  assert.deepEqual(kinds(calls), ['begin', 'cancel'])
})

test('wheel pans in screen space and ctrl zoom keeps its screen anchor fixed', () => {
  const { canvas, viewport, calls } = setup()
  const wheel = canvas.emit('wheel', { deltaX: 20, deltaY: 40 })
  assert.equal(wheel.defaultPrevented, true)
  assert.equal(viewport.x, -20)
  assert.equal(viewport.y, -40)
  const anchor = viewport.toDocument({ x: 100, y: 100 })
  canvas.emit('wheel', { deltaY: -30, ctrlKey: true })
  assert.ok(viewport.scale > 1)
  const after = viewport.toDocument({ x: 100, y: 100 })
  approximately(after.x, anchor.x)
  approximately(after.y, anchor.y)
  assert.deepEqual(kinds(calls), ['view', 'view'])
})

test('mouse and pen hover update only on unowned canvas movement', () => {
  const { canvas, calls } = setup()
  canvas.emit('pointermove', { pointerType: 'mouse', buttons: 0 })
  canvas.emit('pointermove', { pointerType: 'pen', buttons: 0 })
  canvas.emit('pointermove', touch(4, 100, 100))
  assert.deepEqual(kinds(calls), ['hover', 'hover'])
})
