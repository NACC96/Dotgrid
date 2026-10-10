const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function generator (layer, style = {}) {
  const context = vm.createContext({ client: { tool: { settings: { size: { width: 600, height: 300 } } } } })
  vm.runInContext(fs.readFileSync('scripts/generator.js', 'utf8'), context)
  return new context.Generator(layer, style)
}
test('legacy line, quadratic and close path grammar', () => {
  assert.equal(generator([{ type: 'line', vertices: [{ x: 0, y: 0 }, { x: 15, y: 15 }] }]).toString(), 'M0,0 L0,0 L15,15 ')
  assert.equal(generator([{ type: 'bezier', vertices: [{ x: 0, y: 0 }, { x: 15, y: 30 }, { x: 30, y: 0 }] }, { type: 'close', vertices: [] }]).toString(), 'M0,0 Q15,30 30,0 Z ')
})
test('each legacy arc flag and straight-axis fallback', () => {
  const flags = { arc_c: '0,1', arc_r: '0,0', arc_c_full: '1,1', arc_r_full: '1,0' }
  for (const [type, flag] of Object.entries(flags)) {
    assert.equal(generator([{ type, vertices: [{ x: 0, y: 0 }, { x: 30, y: 15 }] }]).toString(), `M0,0 A30,15 0 ${flag} 30,15 `)
    assert.equal(generator([{ type, vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }] }]).toString(), 'M0,0 L30,0 ')
  }
})
test('mirroring uses fixed document dimensions and preserves signed geometry', () => {
  const layer = [{ type: 'line', vertices: [{ x: -15, y: 15 }, { x: 30, y: 45 }] }]
  assert.equal(generator(layer, { mirror_style: 1 }).toString(), 'M-15,15 L-15,15 L30,45 M615,15 L615,15 L570,45 ')
})
test('appended quadratic legacy arrays retain established output', () => {
  const layer = [{ type: 'bezier', vertices: [{ x: 0, y: 0 }, { x: 15, y: 30 }, { x: 30, y: 0 }, { x: 30, y: 0 }, { x: 45, y: 30 }, { x: 60, y: 0 }] }]
  assert.equal(generator(layer).toString(), 'M0,0 Q15,30 30,0 Q30,0 45,30 ')
})
