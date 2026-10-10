'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.DOTGRID_REPO || path.resolve(__dirname, '../..')
const { GridDocument } = require(path.join(root, 'scripts/document.js'))
const Tool = require(path.join(root, 'scripts/tool.js'))
const { ProjectLibrary } = require(path.join(root, 'scripts/projects.js'))
const { Manager } = require(path.join(root, 'scripts/manager.js'))
const setup = (data = GridDocument.empty()) => {
  const client = { document: new GridDocument(data), viewport: { scale: 1 }, projectName: 'Boundary study', update () {} }
  client.tool = new Tool(client)
  return client
}
test('new connected quadratic constructions reach every endpoint without rewriting legacy arrays', async () => {
  const client = setup()
  const points = [{ x: 0, y: 0 }, { x: 15, y: 30 }, { x: 30, y: 0 }, { x: 45, y: 30 }, { x: 60, y: 0 }]
  for (const point of points.slice(0, 3)) client.tool.addVertex(point)
  client.tool.cast('bezier')
  for (const point of points.slice(2)) client.tool.addVertex(point)
  client.tool.cast('bezier')
  assert.match(client.tool.path(), /Q45,30 60,0/)
  assert.match(await (await new Manager(client).prepare('svg')).text(), /Q45,30 60,0/)
  const legacy = GridDocument.empty()
  legacy.layers[0] = [{ type: 'bezier', vertices: [points[0], points[1], points[2], points[2], points[3], points[4]] }]
  const imported = setup(legacy)
  const original = imported.tool.path()
  imported.tool.addVertex(points[4]); imported.tool.addVertex({ x: 75, y: 30 }); imported.tool.addVertex({ x: 90, y: 0 }); imported.tool.cast('bezier')
  assert.equal(imported.tool.layer()[0].vertices.length, 6)
  assert.ok(imported.tool.path().startsWith(original))
  assert.match(imported.tool.path(), /Q75,30 90,0/)
})
test('resized legacy documents retain dimensions through fork and upstream migration', async () => {
  const legacy = ProjectLibrary.validate(fs.readFileSync(path.join(root, 'tests/fixtures/legacy-signed.grid'), 'utf8'))
  const client = setup(legacy)
  client.tool.setSize(900, 450)
  const exported = JSON.parse(await (await new Manager(client).prepare('grid')).text())
  assert.equal(exported.settings.width, 900)
  assert.equal(exported.settings.height, 450)
  assert.deepEqual(ProjectLibrary.validate(exported).settings.size, { width: 900, height: 450 })
  // The pinned upstream Tool.replace prioritizes the legacy width/height pair.
  if (exported.settings.width && exported.settings.height) exported.settings.size = { width: exported.settings.width, height: exported.settings.height }
  assert.deepEqual(exported.settings.size, { width: 900, height: 450 })
  client.document.undo()
  assert.deepEqual(client.document.data.settings.size, { width: 600, height: 300 })
  assert.equal(client.document.data.settings.width, 600)
})
test('case-insensitive none paint is canonical across stroke and fill', () => {
  const data = GridDocument.empty()
  data.styles[0].color = ' NoNe '
  data.styles[0].fill = 'NONE'
  const valid = ProjectLibrary.validate(data)
  assert.equal(valid.styles[0].color, 'none')
  assert.equal(valid.styles[0].fill, 'none')
})
test('at-limit drawings reject duplicate, construction and combined paste before history while remaining exportable', async () => {
  const data = GridDocument.empty()
  data.layers[0] = Array.from({ length: ProjectLibrary.LIMITS.maxVertices / 2 }, () => ({ type: 'line', vertices: [{ x: 15, y: 15 }, { x: 30, y: 30 }] }))
  const client = setup(ProjectLibrary.validate(data))
  let notifications = 0
  client.document.subscribe(() => notifications++)
  const before = client.document.snapshot()
  client.tool.mode = 'duplicate'
  client.tool.begin({ x: 15, y: 15 })
  assert.throws(() => client.tool.end({ x: 45, y: 45 }), error => error.code === 'RESOURCE_LIMIT')
  assert.equal(client.tool.preview, null)
  assert.deepEqual(client.document.snapshot(), before)
  client.tool.mode = 'draw'
  client.tool.addVertex({ x: 60, y: 15 }); client.tool.addVertex({ x: 75, y: 15 })
  assert.throws(() => client.tool.cast('line'), error => error.code === 'RESOURCE_LIMIT')
  assert.equal(client.tool.vertices.length, 2)
  assert.throws(() => client.document.edit('Paste layer', draft => draft.layers[0].push({ type: 'line', vertices: [{ x: 90, y: 15 }, { x: 105, y: 15 }] })), error => error.code === 'RESOURCE_LIMIT')
  assert.equal(client.document.revision, 0)
  assert.equal(client.document.history.canUndo, false)
  assert.equal(notifications, 0)
  assert.deepEqual(client.document.snapshot(), before)
  const exported = JSON.parse(await (await new Manager(client).prepare('grid')).text())
  assert.equal(ProjectLibrary.validate(exported).layers[0].length, data.layers[0].length)
})
