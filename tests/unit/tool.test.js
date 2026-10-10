'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { GridDocument } = require('../../scripts/document.js')
const Tool = require('../../scripts/tool.js')
const setup = () => { const client = { document: new GridDocument(), viewport: { scale: 1 }, update () {} }; return { client, tool: new Tool(client) } }
test('construction stays transient and all committed style and geometry changes undo', () => {
  const { client, tool } = setup()
  tool.addVertex({ x: 15, y: 15 }); tool.addVertex({ x: 45, y: 45 })
  assert.equal(client.document.revision, 0)
  assert.equal(tool.cast('line'), true)
  tool.setStyle('mirror_style', 3)
  client.document.undo(); assert.equal(tool.style().mirror_style, 0)
  client.document.undo(); assert.equal(tool.layer().length, 0)
  client.document.redo(); assert.equal(tool.layer().length, 1)
})
test('preview cancellation is inert and a completed shared-point movement is one action', () => {
  const { client, tool } = setup()
  client.document.edit('Fixture', data => { data.layers[0] = [{ type: 'line', vertices: [{ x: -15, y: 15 }, { x: 30, y: 30 }] }, { type: 'line', vertices: [{ x: 30, y: 30 }, { x: 60, y: 45 }] }] })
  tool.mode = 'move-point'
  tool.begin({ x: 30, y: 30 }); tool.move({ x: 45, y: 60 }); tool.cancel()
  assert.equal(client.document.revision, 1)
  assert.equal(tool.layer()[0].vertices[1].x, 30)
  tool.begin({ x: 30, y: 30 }); tool.move({ x: 45, y: 60 }); tool.end({ x: 45, y: 60 })
  assert.equal(client.document.revision, 2)
  assert.deepEqual(tool.layer()[1].vertices[0], { x: 45, y: 60 })
  assert.deepEqual(tool.layer()[0].vertices[0], { x: -15, y: 15 })
  client.document.undo(); assert.equal(tool.layer()[0].vertices[1].x, 30)
})
test('touch intent adds no point until release; deletion exposes collateral removal', () => {
  const { client, tool } = setup()
  tool.begin({ x: 15, y: 15 }); tool.cancel(); assert.equal(tool.vertices.length, 0)
  tool.begin({ x: 15, y: 15 }); tool.end({ x: 15, y: 15 }); assert.equal(tool.vertices.length, 1)
  tool.clear()
  client.document.edit('Curve', data => { data.layers[0] = [{ type: 'bezier', vertices: [{ x: 15, y: 15 }, { x: 45, y: 45 }, { x: 75, y: 15 }] }, { type: 'close', vertices: [] }] })
  tool.mode = 'delete-point'; tool.begin({ x: 45, y: 45 }); tool.end({ x: 45, y: 45 })
  assert.equal(client.document.revision, 1)
  assert.equal(tool.deletionCount, 2)
  tool.applyDelete(); assert.equal(tool.layer().length, 0)
  client.document.undo(); assert.equal(tool.layer().length, 2)
})
test('same-type append works for layer index zero and preserves legacy continuity', () => {
  const { tool } = setup()
  for (const p of [{x:15,y:15},{x:30,y:30}]) tool.addVertex(p)
  tool.cast('line')
  for (const p of [{x:30,y:30},{x:60,y:30}]) tool.addVertex(p)
  tool.cast('line')
  assert.equal(tool.layer().length, 1)
  assert.equal(tool.layer()[0].vertices.length, 4)
})
test('deleting a closed curve removes its Close instead of closing unrelated earlier artwork', () => {
  const { client, tool } = setup()
  client.document.edit('Fixture', data => { data.layers[0] = [
    { type: 'line', vertices: [{ x: 15, y: 15 }, { x: 30, y: 15 }] },
    { type: 'bezier', vertices: [{ x: 45, y: 15 }, { x: 60, y: 30 }, { x: 75, y: 15 }] },
    { type: 'close', vertices: [] }
  ] })
  tool.mode = 'delete-point'; tool.begin({ x: 60, y: 30 }); tool.end({ x: 60, y: 30 })
  assert.equal(tool.deletionCount, 2)
  tool.applyDelete(); assert.deepEqual(tool.layer().map(segment => segment.type), ['line'])
})
test('point deletion preserves unaffected quadratic primitives with their original coordinates', () => {
  const { client, tool } = setup()
  client.document.edit('Fixture', data => { data.layers[0] = [{ type: 'bezier', vertices: [{x:15,y:15},{x:30,y:45},{x:60,y:15},{x:90,y:45},{x:120,y:15}] }] })
  tool.mode = 'delete-point'; tool.begin({x:30,y:45}); tool.end({x:30,y:45});tool.applyDelete()
  assert.deepEqual(tool.layer(), [{type:'bezier',vertices:[{x:60,y:15},{x:90,y:45},{x:120,y:15}]}])
  client.document.undo(); assert.equal(tool.layer()[0].vertices.length,5)
})
test('screen-space hit testing uses the unsnapped contact at high zoom', () => {
  const {client,tool}=setup();client.viewport.scale=4
  client.document.edit('Fixture',data=>{data.layers[0]=[{type:'line',vertices:[{x:30,y:30},{x:90,y:90}]}]})
  tool.mode='move-point'
  assert.equal(tool.begin({x:30,y:30},{x:35,y:30}),false)
  assert.equal(tool.begin({x:30,y:30},{x:33,y:30}),true)
  tool.cancel()
})
