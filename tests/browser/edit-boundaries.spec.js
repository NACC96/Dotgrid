'use strict'
const { test, expect } = require('@playwright/test')

test('rejected duplicate, Apply and paste keep the limit-sized drawing saved and exportable', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/'); await page.evaluate(() => client.ready)
  await page.evaluate(async () => {
    const payload = GridDocument.empty()
    payload.layers[0] = Array.from({ length: ProjectLibrary.LIMITS.maxVertices / 2 }, () => ({ type: 'line', vertices: [{ x: 30, y: 30 }, { x: 60, y: 60 }] }))
    client.activate(await client.library.create('Limit fixture', payload))
  })
  const before = await page.evaluate(() => ({ id: client.record.id, revision: client.record.revision }))
  await page.locator('#mode').selectOption('duplicate')
  const positions = await page.evaluate(() => [client.viewport.toScreen({ x: 30, y: 30 }), client.viewport.toScreen({ x: 90, y: 90 })])
  const box = await page.locator('#guide').boundingBox()
  await page.mouse.move(box.x + positions[0].x, box.y + positions[0].y)
  await page.mouse.down(); await page.mouse.move(box.x + positions[1].x, box.y + positions[1].y); await page.mouse.up()
  await expect(page.locator('#notice')).toContainText('geometry limit')
  expect(await page.evaluate(() => client.tool.preview)).toBeNull()
  await page.locator('#mode').selectOption('draw')
  await page.evaluate(() => { client.tool.addVertex({ x: 150, y: 30 }); client.tool.addVertex({ x: 180, y: 60 }) })
  await page.locator('#apply').click()
  expect(await page.evaluate(() => client.tool.vertices.length)).toBe(2)
  await page.locator('#cancel').click()
  await page.evaluate(() => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { getData: () => JSON.stringify([{ type: 'line', vertices: [{ x: 210, y: 30 }, { x: 240, y: 60 }] }]) }
    client.renderer.el.dispatchEvent(event)
  })
  expect(await page.evaluate(async () => ({ id: client.record.id, revision: client.record.revision, documentRevision: client.document.revision, state: client.saveState, undo: client.document.history.canUndo, exported: ProjectLibrary.validate(await (await client.manager.prepare('grid')).text()).layers[0].length }))).toEqual({ ...before, documentRevision: 0, state: 'Saved', undo: false, exported: 25000 })
  expect(errors).toEqual([])
})

test('mixed-case none imports stay transparent in Canvas, SVG and PNG', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => client.ready)
  const samples = await page.evaluate(async () => {
    const data = GridDocument.empty()
    data.layers[0] = [{ type: 'line', vertices: [{ x: 30, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 120 }, { x: 30, y: 120 }] }, { type: 'close', vertices: [] }]
    data.styles[0].color = ' NoNe '; data.styles[0].fill = 'NONE'
    await client.importFile(new File([JSON.stringify(data)], 'transparent.grid'))
    client.renderer.showExtras = false; client.renderer.update()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const canvas = client.renderer.el
    const point = client.viewport.toScreen({ x: 75, y: 75 })
    const editor = Array.from(canvas.getContext('2d').getImageData(Math.round(point.x * canvas.width / canvas.clientWidth), Math.round(point.y * canvas.height / canvas.clientHeight), 1, 1).data)
    const alpha = async (file, scale) => {
      const url = URL.createObjectURL(file); const image = new Image()
      try {
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
        const target = document.createElement('canvas'); target.width = image.width; target.height = image.height
        const context = target.getContext('2d'); context.drawImage(image, 0, 0)
        return context.getImageData(75 * scale, 75 * scale, 1, 1).data[3]
      } finally { URL.revokeObjectURL(url) }
    }
    return { color: client.tool.style().color, fill: client.tool.style().fill, editor, svg: await alpha(await client.manager.prepare('svg'), 1), png: await alpha(await client.manager.prepare('png'), 2) }
  })
  expect(samples.color).toBe('none'); expect(samples.fill).toBe('none')
  expect(samples.svg).toBe(0); expect(samples.png).toBe(0)
  // The editor has its paper background; transparent artwork does not paint black.
  expect(samples.editor.slice(0, 3)).not.toEqual([0, 0, 0])
})
