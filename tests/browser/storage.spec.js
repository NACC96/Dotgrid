const { test, expect } = require('@playwright/test')
const fs = require('node:fs')
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/legacy-signed.grid', 'utf8'))

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  if (!await page.evaluate(() => typeof ProjectLibrary === 'function')) {
    await page.addScriptTag({ content: fs.readFileSync('scripts/projects.js', 'utf8') })
  }
})

test('real IndexedDB completes writes before resolving, serializes queued revisions, and survives reopen', async ({ page }) => {
  const result = await page.evaluate(async payload => {
    const library = new ProjectLibrary({ name: 'completion-' + crypto.randomUUID(), storage: null })
    await library.open()
    const original = await library.create('Signed', payload)
    const events = []
    const transaction = library._db.transaction.bind(library._db)
    library._db.transaction = (...args) => {
      const tx = transaction(...args)
      if (args[1] === 'readwrite') tx.addEventListener('complete', () => events.push('complete'))
      return tx
    }
    const second = structuredClone(payload)
    second.styles[0].thickness = 10
    const third = structuredClone(payload)
    third.styles[0].thickness = 20
    const firstSave = library.save(original.id, 'Signed', second, original.revision).then(record => { events.push('resolved'); return record })
    const secondSave = library.save(original.id, 'Signed', third, original.revision + 1)
    await firstSave
    await secondSave
    library.close()
    await library.open()
    const reopened = await library.load(original.id)
    const duplicate = await library.duplicate(original.id, 'Copy')
    const renamed = await library.rename(duplicate.id, 'Renamed', duplicate.revision)
    await library.delete(renamed.id, renamed.revision)
    const list = await library.list()
    library.close()
    return { events, reopened, list }
  }, fixture)
  expect(result.events.slice(0, 2)).toEqual(['complete', 'resolved'])
  expect(result.reopened.revision).toBe(3)
  expect(result.reopened.payload.styles[0].thickness).toBe(20)
  expect(result.reopened.payload.layers[0][0].vertices[0].x).toBe(-15)
  expect(result.reopened.previous.revision).toBe(2)
  expect(result.list).toHaveLength(1)
})

test('two library connections check expected revision atomically and preserve the losing draft', async ({ page }) => {
  const result = await page.evaluate(async payload => {
    const name = 'conflict-' + crypto.randomUUID()
    const a = new ProjectLibrary({ name, storage: null })
    const b = new ProjectLibrary({ name, storage: null })
    const original = await a.create('Original', payload)
    await b.open()
    const localA = structuredClone(payload)
    const localB = structuredClone(payload)
    localA.styles[0].color = '#123456'
    localB.styles[0].color = '#abcdef'
    const results = await Promise.allSettled([
      a.save(original.id, 'A', localA, original.revision),
      b.save(original.id, 'B', localB, original.revision)
    ])
    const loser = results.find(result => result.status === 'rejected')
    const saved = await a.load(original.id)
    const copy = await b.create('Draft copy', localB)
    a.close()
    b.close()
    return { statuses: results.map(result => result.status), conflict: loser && loser.reason.code, saved, copy, localB }
  }, fixture)
  expect(result.statuses.sort()).toEqual(['fulfilled', 'rejected'])
  expect(result.conflict).toBe('CONFLICT')
  expect(result.saved.revision).toBe(2)
  expect(result.localB.styles[0].color).toBe('#abcdef')
  expect(result.copy.payload.styles[0].color).toBe('#abcdef')
})

test('an aborted real transaction rejects saving and retains both durable artwork and exportable draft', async ({ page }) => {
  const result = await page.evaluate(async payload => {
    const library = new ProjectLibrary({ name: 'abort-' + crypto.randomUUID(), storage: null })
    const original = await library.create('Original', payload)
    const draft = structuredClone(payload)
    draft.styles[0].thickness = 12
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args)
      this.transaction.abort()
      return request
    }
    let failure
    try { await library.save(original.id, 'Original', draft, original.revision) } catch (error) { failure = error.code } finally { IDBObjectStore.prototype.put = put }
    const durable = await library.load(original.id)
    const file = await new Manager({ document: { snapshot: () => draft }, projectName: 'Draft' }).prepare('grid')
    library.close()
    return { failure, durable, draft: JSON.parse(await file.text()) }
  }, fixture)
  expect(result.failure).toBe('STORAGE_UNAVAILABLE')
  expect(result.durable.revision).toBe(1)
  expect(result.durable.payload.styles[0].thickness).toBe(3)
  expect(result.draft.styles[0].thickness).toBe(12)
})

test('corrupt newest data is explicitly recovered without writing until a deliberate save', async ({ page }) => {
  const result = await page.evaluate(async payload => {
    const library = new ProjectLibrary({ name: 'recovery-' + crypto.randomUUID(), storage: null })
    const original = await library.create('Original', payload)
    const next = structuredClone(payload)
    next.styles[0].thickness = 12
    const saved = await library.save(original.id, 'Original', next, original.revision)
    const corrupt = { ...saved, payload: { broken: true } }
    await new Promise((resolve, reject) => {
      const tx = library._db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put(corrupt)
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    const recovered = await library.load(original.id)
    const raw = await new Promise(resolve => {
      const request = library._db.transaction('projects', 'readonly').objectStore('projects').get(original.id)
      request.onsuccess = () => resolve(request.result)
    })
    const repaired = await library.save(original.id, 'Recovered', recovered.payload, recovered.revision)
    const future = { ...repaired, schemaVersion: 2 }
    await new Promise(resolve => {
      const tx = library._db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put(future)
      tx.oncomplete = resolve
    })
    let futureCode
    try { await library.load(original.id) } catch (error) { futureCode = error.code }
    library.close()
    return { recovered, raw, repaired, futureCode }
  }, fixture)
  expect(result.recovered.recovered).toBe(true)
  expect(result.recovered.recoveredRevision).toBe(1)
  expect(result.recovered.revision).toBe(2)
  expect(result.recovered.payload.styles[0].thickness).toBe(3)
  expect(result.raw.payload).toEqual({ broken: true })
  expect(result.repaired.revision).toBe(3)
  expect(result.repaired.previous.revision).toBe(1)
  expect(result.futureCode).toBe('UNSUPPORTED_SCHEMA')
})

test('unavailable storage and denied persistence report capability accurately', async ({ page }) => {
  const result = await page.evaluate(async () => {
    let unavailable
    try { await new ProjectLibrary({ indexedDB: null }).open() } catch (error) { unavailable = error.code }
    const denied = new ProjectLibrary({ name: 'denied-' + crypto.randomUUID(), storage: { persisted: async () => false, persist: async () => false } })
    await denied.open()
    const persistence = denied.persistence
    denied.close()
    return { unavailable, persistence }
  })
  expect(result.unavailable).toBe('STORAGE_UNAVAILABLE')
  expect(result.persistence).toMatchObject({ supported: true, persisted: false, requested: true })
})

test('blocked IndexedDB upgrade reports another editor and preserves records', async ({ page }) => {
  const result = await page.evaluate(async payload => {
    const name = 'blocked-' + crypto.randomUUID()
    const library = new ProjectLibrary({ name, storage: null })
    const project = await library.create('Preserved', payload)
    library.close()
    const held = await new Promise(resolve => { const request = indexedDB.open(name, 1); request.onsuccess = () => resolve(request.result) })
    let upgradeRequest
    const blocked = new ProjectLibrary({ name, storage: null, indexedDB: { open: database => { upgradeRequest = indexedDB.open(database, 2); return upgradeRequest } } })
    let failure
    try { await blocked.open() } catch (error) { failure = { code: error.code, message: error.message } }
    const finished = new Promise(resolve => upgradeRequest.addEventListener('success', resolve))
    held.close()
    await finished
    const newer = await new Promise(resolve => { const request = indexedDB.open(name, 2); request.onsuccess = () => resolve(request.result) })
    const preserved = await new Promise(resolve => { const request = newer.transaction('projects').objectStore('projects').get(project.id); request.onsuccess = () => resolve(request.result) })
    newer.close()
    return { failure, preserved }
  }, fixture)
  expect(result.failure.code).toBe('STORAGE_BLOCKED')
  expect(result.failure.message).toMatch(/another|tab/i)
  expect(result.preserved.payload.layers[0][0].vertices[0].x).toBe(-15)
})

test('actual PNG export retains transparent bounds and layer order at the 2x document resolution', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = GridDocument.empty()
    data.settings.size = { width: 100, height: 100 }
    const rectangle = (a, b) => [{ type: 'line', vertices: [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }] }, { type: 'close', vertices: [] }]
    data.layers[2] = rectangle(10, 90)
    data.layers[0] = rectangle(30, 70)
    data.styles[2].fill = '#ff0000'
    data.styles[0].fill = '#0000ff'
    const manager = new Manager({ document: { snapshot: () => data }, projectName: 'Art', viewport: { zoom: 50 } })
    const file = await manager.prepare('png')
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url })
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      return { width: image.width, height: image.height, transparent: [...context.getImageData(0, 0, 1, 1).data], top: [...context.getImageData(100, 100, 1, 1).data], bottom: [...context.getImageData(40, 40, 1, 1).data], name: file.name, type: file.type }
    } finally { URL.revokeObjectURL(url) }
  })
  expect(result).toMatchObject({ width: 200, height: 200, transparent: [0, 0, 0, 0], top: [0, 0, 255, 255], bottom: [255, 0, 0, 255], name: 'Art.png', type: 'image/png' })
})

test('a prepared .grid download uses its actual filename and import picker cancellation is inert', async ({ page }) => {
  const pending = page.waitForEvent('download')
  await page.evaluate(async payload => {
    window.preparedGrid = await new Manager({ document: { snapshot: () => payload }, projectName: 'Signed backup' }).prepare('grid')
    new Source().download(window.preparedGrid)
  }, fixture)
  const download = await pending
  expect(download.suggestedFilename()).toBe('Signed backup.grid')
  const cancelled = await page.evaluate(async () => {
    const click = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () { this.dispatchEvent(new Event('cancel')) }
    let callback = false
    try { return { result: await new Source().choose(() => { callback = true }), callback } } finally { HTMLInputElement.prototype.click = click }
  })
  expect(cancelled).toEqual({ result: null, callback: false })
})
