const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { build, RUNTIME_FILES, STYLE_FILES } = require('../../tools/build-pwa.js')

let directory, source, server, origin, releases, selected, broken, disconnected
test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dotgrid-update-'))
  source = path.join(directory, 'source')
  fs.mkdirSync(source)
  const repo = path.resolve(__dirname, '../..')
  for (const name of [...RUNTIME_FILES, ...STYLE_FILES, 'LICENSE', 'LICENSE.by-nc-sa-4.0.md']) {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true })
    fs.copyFileSync(path.join(repo, name), path.join(source, name))
  }
  fs.cpSync(path.join(repo, 'public'), path.join(source, 'public'), { recursive: true })
  releases = []
  const clientSource = fs.readFileSync(path.join(source, 'scripts/client.js'), 'utf8')
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(source, 'scripts/client.js'), clientSource + `\nwindow.__DOTGRID_TEST_RUNTIME__ = ${i + 1}\n`)
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'public/manifest.webmanifest')))
    manifest.description = `Release fixture ${i + 1}`
    fs.writeFileSync(path.join(source, 'public/manifest.webmanifest'), JSON.stringify(manifest))
    releases.push(build({ sourceRoot: source, outDir: path.join(directory, `release-${i}`), writeLegacy: false }))
  }
  expect(new Set(releases.map(release => release.jsAsset)).size).toBe(3)
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' }
  server = http.createServer((req, res) => {
    if (disconnected) { res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Fixture network unavailable'); return }
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/index.html' || pathname === '/404.html') {
      res.writeHead(301, { Location: pathname === '/index.html' ? '/' : '/404' }).end()
      return
    }
    const name = pathname === '/404' ? '404.html' : pathname.slice(1) || 'index.html'
    const root = releases[selected].outDir
    const file = path.resolve(root, name)
    if (broken?.name === name) {
      if (broken.mode === 'missing') res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Missing release resource')
      else if (broken.mode === 'digest') res.writeHead(200, { 'Content-Type': 'application/manifest+json' }).end('{"name":"Wrong release"}')
      else res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Wrong asset</title>')
      return
    }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end('Not found'); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache' })
    res.end(fs.readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})
test.beforeEach(() => { selected = 0; broken = null; disconnected = false })
test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})
// A release server is deliberately shared by this sequence within one worker.
test.describe.configure({ mode: 'serial' })

async function ready (page) {
  await page.goto(origin)
  await expect.poll(() => page.evaluate(() => window.client?.saveState)).toBe('Saved')
  await expect.poll(() => page.evaluate(() => window.client?.pwa?.offlineReady), { timeout: 15000 }).toBe(true)
  expect(await page.evaluate(() => window.__DOTGRID_TEST_RUNTIME__)).toBe(1)
}
async function offer (page, index = 1) {
  selected = index
  await page.evaluate(() => client.pwa.checkForUpdate())
  await expect.poll(() => page.evaluate(() => client.pwa.updateAvailable), { timeout: 15000 }).toBe(true)
}
async function adopt (page, release) {
  await page.evaluate(() => { window.updateResult = client.pwa.saveAndUpdate() })
  await expect(page.locator('meta[name="dotgrid-release"]')).toHaveAttribute('content', release, { timeout: 15000 })
  await expect.poll(() => page.evaluate(() => window.client?.saveState)).toBe('Saved')
}

test('pending construction and failed checkpoint postpone updating without reloading', async ({ page }) => {
  await ready(page)
  await offer(page)
  const original = await page.evaluate(() => document.querySelector('meta[name="dotgrid-release"]').content)
  await page.evaluate(() => { client.tool.addVertex({ x: 15, y: 15 }); window.updateResult = client.pwa.saveAndUpdate() })
  await expect(page.getByRole('button', { name: 'Stay', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  expect(await page.evaluate(() => window.updateResult)).toBe(false)
  expect(await page.evaluate(() => client.tool.vertices.length)).toBe(1)
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  await page.evaluate(() => {
    client.tool.clear()
    client.document.edit('unsaved fixture', data => { data.styles[0].color = '#654321' })
    client.library.save = async () => { throw new Error('Fixture storage write failed') }
  })
  expect(await page.evaluate(() => client.pwa.saveAndUpdate())).toBe(false)
  expect(await page.evaluate(() => client.saveState)).toBe('Save failed')
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  expect(await page.evaluate(() => client.tool.styles[0].color)).toBe('#654321')
  expect(await page.evaluate(() => document.querySelector('meta[name="dotgrid-release"]').content)).toBe(original)
})

test('a peer with a failed save keeps its draft and defers the release', async ({ context, page }) => {
  await ready(page)
  const other = await context.newPage()
  await ready(other)
  await other.evaluate(() => {
    client.library.save = async () => { throw new Error('Fixture peer write failed') }
    client.document.edit('peer dirty fixture', data => { data.styles[1].color = '#775533' })
  })
  await expect.poll(() => other.evaluate(() => client.saveState)).toBe('Save failed')
  await offer(page)
  expect(await page.evaluate(() => client.pwa.saveAndUpdate())).toBe(false)
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  expect(await other.evaluate(() => client.editFrozen)).toBe(false)
  expect(await other.evaluate(() => client.tool.styles[1].color)).toBe('#775533')
  expect(await page.evaluate(() => client.pwa.updateAvailable)).toBe(true)
})

test('offline update checking leaves editing available and reconnect offers the release', async ({ context, page }) => {
  await ready(page)
  disconnected = true
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  selected = 1
  expect(await page.evaluate(() => client.pwa.checkForUpdate())).toBe(false)
  expect(await page.evaluate(async () => {
    client.document.edit('postponed offline fixture', data => { data.styles[0].color = '#335577' })
    return client.checkpoint()
  })).toBe(true)
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  expect(await page.evaluate(() => ({ available: client.pwa.updateAvailable, waiting: !!client.pwa.registration.waiting }))).toEqual({ available: false, waiting: false })
  disconnected = false
  await context.setOffline(false)
  await expect.poll(() => page.evaluate(() => client.pwa.updateAvailable), { timeout: 15000 }).toBe(true)
  expect(await page.evaluate(() => client.tool.styles[0].color)).toBe('#335577')
})

test('another pending or unresponsive editor defers activation; clean peers reload once and recover through releases', async ({ context, page }) => {
  await page.addInitScript(() => sessionStorage.setItem('load-count', String(Number(sessionStorage.getItem('load-count') || 0) + 1)))
  await ready(page)
  const saved = await page.evaluate(async () => {
    client.document.edit('persistent fixture', data => { data.styles[2].color = '#446688' })
    await client.checkpoint()
    return { id: client.record.id, revision: client.record.revision, payload: client.document.snapshot() }
  })
  const other = await context.newPage()
  await ready(other)
  await other.evaluate(() => client.tool.addVertex({ x: 30, y: 30 }))
  await offer(page)
  expect(await page.evaluate(() => client.pwa.saveAndUpdate())).toBe(false)
  expect(await other.evaluate(() => client.tool.vertices.length)).toBe(1)
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  await other.evaluate(() => client.tool.clear())
  // A document without application cooperation shares this worker scope.
  const unresponsive = await context.newPage()
  await unresponsive.goto(origin + '/404.html')
  expect(await page.evaluate(() => client.pwa.saveAndUpdate())).toBe(false)
  expect(await page.evaluate(() => client.pwa.status)).toContain('did not respond')
  expect(await page.evaluate(() => client.editFrozen)).toBe(false)
  await unresponsive.close()
  const loads = await page.evaluate(() => Number(sessionStorage.getItem('load-count')))
  await adopt(page, releases[1].release)
  await expect(other.locator('meta[name="dotgrid-release"]')).toHaveAttribute('content', releases[1].release)
  expect(await page.evaluate(() => window.__DOTGRID_TEST_RUNTIME__)).toBe(2)
  expect(await other.evaluate(() => window.__DOTGRID_TEST_RUNTIME__)).toBe(2)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('load-count')))).toBe(loads + 1)
  expect(await page.evaluate(() => ({ id: client.record.id, revision: client.record.revision, payload: client.document.snapshot() }))).toEqual(saved)
  await offer(page, 2)
  await adopt(page, releases[2].release)
  expect(await page.evaluate(() => window.__DOTGRID_TEST_RUNTIME__)).toBe(3)
  expect(await page.evaluate(() => ({ id: client.record.id, revision: client.record.revision, payload: client.document.snapshot() }))).toEqual(saved)
  expect(await page.evaluate(() => caches.keys())).toHaveLength(2)
})

for (const mode of ['mime', 'digest', 'missing']) test(`${mode} resource failure rejects new precache and the previous offline release remains usable`, async ({ context, page }) => {
  await ready(page)
  selected = 1
  broken = { name: mode === 'digest' ? 'manifest.webmanifest' : 'icons/icon-512.png', mode }
  await page.evaluate(async () => {
    client.pwa.registration.addEventListener('updatefound', () => {
      const worker = client.pwa.registration.installing
      worker.addEventListener('statechange', () => { window.rejectedInstall = worker.state === 'redundant' })
    })
    await client.pwa.checkForUpdate()
  })
  await expect.poll(() => page.evaluate(() => window.rejectedInstall), { timeout: 15000 }).toBe(true)
  expect(await page.evaluate(() => client.pwa.updateAvailable)).toBe(false)
  expect(await page.evaluate(() => document.querySelector('meta[name="dotgrid-release"]').content)).toBe(releases[0].release)
  await context.setOffline(true)
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.client?.pwa?.offlineReady)).toBe(true)
  expect(await page.evaluate(() => document.querySelector('meta[name="dotgrid-release"]').content)).toBe(releases[0].release)
  expect(await page.evaluate(() => client.checkpoint())).toBe(true)
})
