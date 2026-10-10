const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { build } = require('../../tools/build-pwa.js')

let directory, server, origin, artifact
test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotgrid-offline-'))
  artifact = build({ outDir: path.join(directory, 'dist'), writeLegacy: false })
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' }
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/index.html' || pathname === '/404.html') {
      res.writeHead(301, { Location: pathname === '/index.html' ? '/' : '/404' }).end()
      return
    }
    const name = pathname === '/404' ? '404.html' : pathname.slice(1) || 'index.html'
    const file = path.resolve(artifact.outDir, name)
    if (!file.startsWith(artifact.outDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache', 'Content-Security-Policy': fs.readFileSync(path.join(artifact.outDir, '_headers'), 'utf8').match(/Content-Security-Policy: (.+)/)[1] })
    res.end(fs.readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})

async function ready (page) {
  await page.goto(origin)
  await expect.poll(() => page.evaluate(() => window.client?.saveState)).toBe('Saved')
  await expect.poll(() => page.evaluate(() => window.client?.pwa?.offlineReady), { timeout: 15000 }).toBe(true)
}

test('complete generated shell cold-launches offline and retains saved artwork', async ({ context, page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  const expected = await page.evaluate(async () => {
    client.document.edit('offline fixture', data => { data.layers[0].push({ type: 'line', vertices: [{ x: 15, y: 30 }, { x: 90, y: 120 }] }) })
    if (!await client.checkpoint()) throw new Error('Fixture save failed')
    return client.document.snapshot()
  })
  await page.close()
  await context.setOffline(true)
  const reopened = await context.newPage()
  await ready(reopened)
  expect(await reopened.evaluate(() => client.document.snapshot())).toEqual(expected)
  expect(await reopened.evaluate(async () => {
    client.document.edit('offline edit', data => { data.styles[0].color = '#123456' })
    return client.checkpoint()
  })).toBe(true)
  await reopened.reload()
  await expect.poll(() => reopened.evaluate(() => client.saveState)).toBe('Saved')
  expect(await reopened.evaluate(() => client.tool.styles[0].color)).toBe('#123456')
  expect(errors).toEqual([])
})

test('offline readiness detects missing cache entries and cache repair preserves IndexedDB', async ({ page }) => {
  await ready(page)
  const before = await page.evaluate(async css => {
    client.document.edit('saved fixture', data => { data.styles[1].color = '#224466' })
    if (!await client.checkpoint()) throw new Error('Fixture save failed')
    const snapshot = client.document.snapshot()
    for (const name of await caches.keys()) if (name.startsWith('dotgrid-shell-')) await (await caches.open(name)).delete(new URL(css, location.href))
    return { id: client.record.id, revision: client.record.revision, snapshot }
  }, artifact.cssAsset)
  expect(await page.evaluate(() => client.pwa.verify())).toBe(false)
  expect(await page.evaluate(() => client.pwa.status)).toContain('incomplete')
  expect(await page.evaluate(() => client.pwa.repair())).toBe(true)
  await page.reload()
  await expect.poll(() => page.evaluate(() => client.saveState)).toBe('Saved')
  expect(await page.evaluate(() => ({ id: client.record.id, revision: client.record.revision, snapshot: client.document.snapshot() }))).toEqual(before)
})
