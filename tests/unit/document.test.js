const test = require('node:test')
const assert = require('node:assert/strict')
const { GridDocument } = require('../../scripts/document.js')

test('document history restores geometry, style and dimensions together', () => {
  const doc = new GridDocument()
  const initial = doc.snapshot()
  doc.edit('compound edit', data => {
    data.layers[0].push({ type: 'line', vertices: [{ x: -15, y: 15 }, { x: 30, y: 45 }] })
    data.styles[0].color = '#123456'
    data.settings.size.width = 900
  })
  assert.equal(doc.revision, 1)
  assert.equal(doc.undo(), true)
  assert.deepEqual(doc.snapshot(), initial)
  assert.equal(doc.redo(), true)
  assert.equal(doc.data.styles[0].color, '#123456')
  assert.equal(doc.data.layers[0][0].vertices[0].x, -15)
})
test('bounded history, redo branching and project replacement stay independent', () => {
  const doc = new GridDocument()
  assert.equal(doc.undo(), false)
  for (let i = 0; i < 30; i++) doc.edit('thickness', d => { d.styles[0].thickness = i + 10 })
  let count = 0
  while (doc.undo()) count++
  assert.equal(count, 20)
  doc.edit('fork', d => { d.styles[0].color = '#ffffff' })
  assert.equal(doc.redo(), false)
  doc.reset(GridDocument.empty())
  assert.equal(doc.undo(), false)
  assert.equal(doc.data.styles[0].thickness, 3)
})
test('no-op edits and cancelled drafts do not notify or change history', () => {
  const doc = new GridDocument()
  let changes = 0
  doc.subscribe(() => changes++)
  const draft = doc.snapshot()
  draft.styles[0].fill = '#111111'
  assert.equal(doc.edit('noop', () => {}), false)
  assert.equal(doc.revision, 0)
  assert.equal(changes, 0)
  doc.edit('fill', d => { d.styles[0].fill = '#111111' })
  doc.undo()
  doc.redo()
  assert.equal(changes, 3)
})
