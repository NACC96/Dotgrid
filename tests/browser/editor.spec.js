'use strict'
const { test, expect } = require('@playwright/test')
const path = require('node:path')
async function ready (page) { await page.goto('/'); await page.evaluate(() => client.ready); await expect(page.locator('#guide')).toBeVisible() }
async function point (page, x, y) { const screen = await page.evaluate(p => client.viewport.toScreen(p), { x, y }); const box = await page.locator('#guide').boundingBox(); await page.mouse.click(box.x + screen.x, box.y + screen.y) }
async function pen (page, events) {
  await page.evaluate(events => {
    const canvas = client.renderer.el; const rect = canvas.getBoundingClientRect(); const captured = new Set()
    const original = [canvas.setPointerCapture, canvas.hasPointerCapture, canvas.releasePointerCapture]
    canvas.setPointerCapture = id => captured.add(id); canvas.hasPointerCapture = id => captured.has(id); canvas.releasePointerCapture = id => captured.delete(id)
    for (const event of events) { const p = client.viewport.toScreen({ x: event.x || 0, y: event.y || 0 }); canvas.dispatchEvent(new PointerEvent(event.type, { bubbles: true, cancelable: true, pointerId: event.id || 10, pointerType: event.pointerType || 'pen', button: 0, buttons: event.type === 'pointerup' ? 0 : 1, clientX: rect.left + p.x, clientY: rect.top + p.y })) }
    ;[canvas.setPointerCapture, canvas.hasPointerCapture, canvas.releasePointerCapture] = original
  }, events)
}
test('all construction types, Close, history and stable dimensions work on screen', async ({ page }) => {
  await ready(page)
  for (const primitive of ['line', 'arc_c', 'arc_r', 'arc_c_full', 'arc_r_full', 'bezier']) {
    await page.locator('#primitive').selectOption(primitive)
    await point(page, 30, 30); await point(page, 90, 90)
    if (primitive === 'bezier') { await expect(page.locator('#apply')).toBeDisabled(); await point(page, 150, 30) }
    await page.locator('#apply').click()
  }
  await page.locator('#close-path').click()
  expect(await page.evaluate(() => client.tool.layer().map(segment => segment.type))).toEqual(['line', 'arc_c', 'arc_r', 'arc_c_full', 'arc_r_full', 'bezier', 'close'])
  const before = await page.evaluate(() => ({ data: client.document.snapshot(), revision: client.document.revision, history: client.document.history.index }))
  await page.setViewportSize({ width: 420, height: 740 }); await page.locator('#details-toggle').click()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => ({ data: client.document.snapshot(), revision: client.document.revision, history: client.document.history.index }))).toEqual(before)
  await page.locator('#undo').click(); expect(await page.evaluate(() => client.tool.layer().at(-1).type)).toBe('bezier')
  await page.locator('#redo').click(); expect(await page.evaluate(() => client.tool.layer().at(-1).type)).toBe('close')
})
test('pending points require a choice before layer/context changes; controls do not add points', async ({ page }) => {
  await ready(page); await point(page, 30, 30)
  await page.locator('#layer-1').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  expect(await page.evaluate(() => client.tool.index)).toBe(0)
  expect(await page.evaluate(() => client.tool.vertices.length)).toBe(1)
  await page.locator('#remove-point').click(); await page.locator('#layer-1').click()
  expect(await page.evaluate(() => client.tool.index)).toBe(1)
  expect(await page.evaluate(() => client.document.revision)).toBe(0)
})
test('synthetic contact integration cancels previews, avoids palm edits, and finishes one drag', async ({ page }) => {
  await ready(page)
  await pen(page, [{type:'pointerdown',x:30,y:30},{type:'pointerup',x:30,y:30},{type:'pointerdown',x:90,y:90},{type:'pointerup',x:90,y:90}])
  await page.locator('#apply').click()
  await page.locator('#mode').selectOption('move-point')
  await pen(page, [{type:'pointerdown',x:30,y:30},{type:'pointermove',x:60,y:60},{type:'pointercancel',x:60,y:60}])
  expect(await page.evaluate(() => client.document.revision)).toBe(1)
  expect(await page.evaluate(() => client.tool.layer()[0].vertices[0])).toEqual({x:30,y:30})
  await pen(page, [{type:'pointerdown',x:30,y:30},{type:'pointermove',x:60,y:60},{type:'pointerup',x:60,y:60}])
  expect(await page.evaluate(() => client.document.revision)).toBe(2)
  expect(await page.evaluate(() => client.tool.layer()[0].vertices[0])).toEqual({x:60,y:60})
  await page.locator('#mode').selectOption('draw')
  await pen(page, [{type:'pointerdown',pointerType:'touch',id:20,x:30,y:30},{type:'pointerup',pointerType:'touch',id:20,x:30,y:30}])
  expect(await page.evaluate(() => client.tool.vertices.length)).toBe(0)
  await page.locator('#touch-mode').click()
  await pen(page, [{type:'pointerdown',pointerType:'touch',id:20,x:30,y:30},{type:'pointerdown',pointerType:'touch',id:21,x:90,y:90},{type:'pointerup',pointerType:'touch',id:20,x:30,y:30},{type:'pointerup',pointerType:'touch',id:21,x:90,y:90}])
  expect(await page.evaluate(() => client.tool.vertices.length)).toBe(0)
})
test('style, dimensions, merge and erase are full document undo actions; field shortcuts stay local', async ({ page }) => {
  await ready(page); await point(page,30,30); await point(page,90,90); await page.locator('#apply').click()
  await page.locator('#details-toggle').click()
  await page.locator('#color').fill('#123456'); await page.locator('#color-apply').click()
  await page.locator('#mirror').selectOption('3'); await page.locator('#fill').click()
  await page.locator('#thickness').fill('7'); await page.locator('#thickness').blur()
  await page.locator('#width').fill('900'); await page.locator('#size-apply').click()
  expect(await page.evaluate(() => client.document.data.settings.size.width)).toBe(900)
  await page.locator('#undo').click(); expect(await page.evaluate(() => client.document.data.settings.size.width)).toBe(600)
  await page.locator('#width').focus(); await page.keyboard.press('ControlOrMeta+z')
  expect(await page.evaluate(() => client.document.data.styles[0].thickness)).toBe(7)
  await page.locator('#erase').click(); await page.getByRole('button',{name:'Confirm',exact:true}).click()
  expect(await page.evaluate(() => client.tool.length())).toBe(0)
  await page.locator('#undo').click(); expect(await page.evaluate(() => client.tool.length())).toBe(1)
})
test('invalid file leaves document and history intact; grid/SVG/PNG exports use document bounds', async ({ page }) => {
  await ready(page); await point(page,30,30); await point(page,90,90); await page.locator('#apply').click()
  const before = await page.evaluate(() => client.tool.export())
  const invalid = await page.evaluate(async () => { try { await client.importFile(new File(['oops'],'broken.grid')); return false } catch (error) { return error.code } })
  expect(invalid).toBe('INVALID_JSON'); expect(await page.evaluate(() => client.tool.export())).toBe(before)
  const exported = await page.evaluate(async () => {
    client.viewport.zoomAt(4,{x:50,y:50})
    const grid = await client.manager.prepare('grid'); const svg = await client.manager.prepare('svg'); const png = await client.manager.prepare('png')
    const bitmap = await createImageBitmap(png); const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height; const ctx=canvas.getContext('2d'); ctx.drawImage(bitmap,0,0)
    const result={grid:JSON.parse(await grid.text()),svg:await svg.text(),png:{width:bitmap.width,height:bitmap.height,alpha:ctx.getImageData(0,0,1,1).data[3]}}
    bitmap.close(); return result
  })
  expect(exported.grid.settings.size).toEqual({width:600,height:300})
  expect(exported.svg).toContain('viewBox="0 0 600 300"'); expect(exported.svg).toContain('M30,30')
  expect(exported.png).toEqual({width:1200,height:600,alpha:0})
  await page.locator('#export').click(); await page.getByRole('button',{name:'Prepare .grid',exact:true}).click()
  await expect(page.getByRole('button',{name:'Download',exact:true})).toBeEnabled()
  const downloadPromise=page.waitForEvent('download'); await page.getByRole('button',{name:'Download',exact:true}).click()
  const download=await downloadPromise; expect(download.suggestedFilename()).toMatch(/\.grid$/)
})
test('cursor and pan frames reuse geometry; standard fixture draws without SVG image loads', async ({ page }) => {
  await ready(page)
  await page.evaluate(async payload => { const record = await client.library.create('Benchmark', payload); client.activate(record) }, JSON.parse(require('node:fs').readFileSync(path.join(__dirname,'../fixtures/benchmark-standard.grid'),'utf8')))
  await page.waitForTimeout(150)
  const count=await page.evaluate(()=>client.renderer.metrics.pathBuilds)
  await page.mouse.move(100,300); await page.mouse.move(400,400); await page.waitForTimeout(70)
  expect(await page.evaluate(()=>client.renderer.metrics.pathBuilds)).toBe(count)
  const metrics=await page.evaluate(()=>client.renderer.metrics)
  expect(metrics.frames).toBeGreaterThan(0); expect(metrics.backingPixels).toBeLessThanOrEqual(16777216)
})
test('semantic controls have minimum touch targets in narrow portrait', async ({ page }) => {
  await ready(page); await page.setViewportSize({width:390,height:844})
  const invalid=await page.locator('button:visible,select:visible,input:visible').evaluateAll(elements=>elements.filter(el=>el.getBoundingClientRect().height<44).map(el=>el.id))
  expect(invalid).toEqual([])
  await expect(page.locator('#touch-mode')).toHaveAttribute('aria-pressed','false')
})
test('missing required drawing capabilities show an accurate message before starting the editor',async({page})=>{
  await page.addInitScript(()=>{window.Path2D=undefined})
  await page.goto('/')
  await expect(page.locator('body')).toContainText('missing vector paths')
  await expect(page.locator('#guide')).toHaveCount(0)
})
