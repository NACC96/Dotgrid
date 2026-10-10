'use strict'

const { test, expect } = require('@playwright/test')

async function ready (page) {
  await page.goto('/')
  await page.evaluate(() => client.ready)
  await expect(page.locator('#guide')).toBeVisible()
  await expect(page.locator('#save-status')).toHaveText('Saved')
}

async function point (page, x, y) {
  const screen = await page.evaluate(point => client.viewport.toScreen(point), { x, y })
  const box = await page.locator('#guide').boundingBox()
  await page.mouse.click(box.x + screen.x, box.y + screen.y)
}

async function gateStorage (page, method) {
  await page.evaluate(method => {
    const original = client.library[method]
    let release
    const gate = new Promise(resolve => { release = resolve })
    window.storageEntered = false
    window.storageCalls = 0
    window.releaseStorage = release
    client.library[method] = async (...args) => {
      window.storageEntered = true
      window.storageCalls++
      await gate
      return original(...args)
    }
  }, method)
}

async function draftState (page) {
  return page.evaluate(() => ({
    id: client.record && client.record.id,
    name: client.projectName,
    payload: client.document.snapshot(),
    revision: client.document.revision,
    points: client.tool.vertices,
    frozen: client.editFrozen
  }))
}

for (const transition of ['new', 'import']) {
  test(`delayed ${transition} creation keeps the checkpointed drawing frozen and rejects a second transition`, async ({ page }) => {
    await ready(page)
    await point(page, 30, 30)
    await point(page, 90, 90)
    await page.locator('#apply').click()
    await expect(page.locator('#save-status')).toHaveText('Saved')
    const before = await draftState(page)
    await gateStorage(page, 'create')

    if (transition === 'new') {
      await page.evaluate(() => { window.transitionResult = client.newProject() })
      await page.getByLabel('Name', { exact: true }).fill('Next drawing')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
    } else {
      await page.evaluate(() => {
        const payload = GridDocument.empty()
        payload.styles[0].thickness = 9
        payload.layers[0] = [{ type: 'line', vertices: [{ x: -15, y: 15 }, { x: 45, y: 60 }] }]
        window.importedPayload = payload
        window.transitionResult = client.importFile(new File([JSON.stringify(payload)], 'Imported drawing.grid', { type: 'application/json' }))
      })
    }

    await expect.poll(() => page.evaluate(() => window.storageEntered)).toBe(true)
    await expect.poll(() => page.evaluate(() => client.editFrozen)).toBe(true)
    await point(page, 150, 30)
    await point(page, 210, 90)
    const whileWaiting = await draftState(page)
    expect(whileWaiting).toEqual({ ...before, frozen: true })
    const second = await page.evaluate(() => client.importPayload(GridDocument.empty(), { name: 'Second transition.grid' }))
    expect(second).toBe(false)
    expect(await page.evaluate(() => window.storageCalls)).toBe(1)
    expect(await page.getByRole('dialog').count()).toBe(0)

    await page.evaluate(() => window.releaseStorage())
    await page.evaluate(() => window.transitionResult)
    await expect.poll(() => page.evaluate(() => client.editFrozen)).toBe(false)
    const after = await draftState(page)
    expect(after.id).not.toBe(before.id)
    expect(after.name).toBe(transition === 'new' ? 'Next drawing' : 'Imported drawing')
    expect(after.revision).toBe(0)
    expect(after.points).toEqual([])
    const expected = await page.evaluate(transition => transition === 'new' ? GridDocument.empty() : window.importedPayload, transition)
    expect(after.payload).toEqual(expected)
    expect((await page.evaluate(id => client.library.load(id), before.id)).payload).toEqual(before.payload)
  })
}

test('deleting the current project freezes canvas edits until deletion finishes and cannot resurrect it', async ({ page }) => {
  await ready(page)
  await point(page, 30, 30)
  await point(page, 90, 90)
  await page.locator('#apply').click()
  await expect(page.locator('#save-status')).toHaveText('Saved')
  const before = await draftState(page)
  await gateStorage(page, 'delete')
  await page.evaluate(() => {
    const create = client.library.create
    window.createsDuringDelete = 0
    client.library.create = (...args) => { window.createsDuringDelete++; return create(...args) }
  })
  await page.locator('#projects').click()
  await page.locator('.project-row').filter({ has: page.getByRole('button', { name: before.name, exact: true }) }).getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.storageEntered)).toBe(true)
  await expect.poll(() => page.evaluate(() => client.editFrozen)).toBe(true)
  await point(page, 150, 30)
  await point(page, 210, 90)
  expect(await draftState(page)).toEqual({ ...before, frozen: true })
  expect(await page.evaluate(() => client.newProject())).toBe(false)

  await page.evaluate(() => window.releaseStorage())
  await expect(page.locator('#save-status')).toHaveText('Temporary / not saved')
  await expect.poll(() => page.evaluate(() => client.editFrozen)).toBe(false)
  expect(await page.evaluate(() => ({ record: client.record, payload: client.document.snapshot(), points: client.tool.vertices }))).toEqual({ record: null, payload: await page.evaluate(() => GridDocument.empty()), points: [] })
  // Allow any previously scheduled autosave to run: no click during the gate
  // may leave an edit that recreates the deleted project after handoff.
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.createsDuringDelete)).toBe(0)
  expect(await page.evaluate(() => client.library.list())).toEqual([])
  expect(await page.evaluate(async id => { try { await client.library.load(id); return 'loaded' } catch (error) { return error.code } }, before.id)).toBe('NOT_FOUND')
})

test('a late save from A cannot reattach A after B is activated or write B artwork into A', async ({ page }) => {
  await ready(page)
  const originalId = await page.evaluate(() => client.record.id)
  await page.evaluate(async () => {
    const payload = GridDocument.empty()
    payload.styles[0].thickness = 27
    window.projectB = await client.library.create('Project B', payload)
  })
  await gateStorage(page, 'save')
  await page.evaluate(() => {
    client.document.edit('A draft', data => { data.styles[0].thickness = 11 })
    window.saveAResult = client.saveDraft()
  })
  await expect.poll(() => page.evaluate(() => window.storageEntered)).toBe(true)
  await page.evaluate(() => client.activate(window.projectB))
  const projectB = await draftState(page)
  expect(projectB.payload.styles[0].thickness).toBe(27)
  await page.evaluate(() => window.releaseStorage())
  expect(await page.evaluate(() => window.saveAResult)).toBe(false)
  expect(await draftState(page)).toEqual(projectB)
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect(await page.evaluate(() => localStorage.getItem('dotgrid:last-project'))).toBe(projectB.id)

  await page.evaluate(() => client.document.edit('B draft', data => { data.styles[0].thickness = 28 }))
  await expect(page.locator('#save-status')).toHaveText('Saved')
  const stored = await page.evaluate(async ids => ({ a: await client.library.load(ids.a), b: await client.library.load(ids.b), calls: window.storageCalls }), { a: originalId, b: projectB.id })
  expect(stored.a.payload.styles[0].thickness).toBe(11)
  expect(stored.a.name).toBe('Untitled')
  expect(stored.b.payload.styles[0].thickness).toBe(28)
  expect(stored.b.name).toBe('Project B')
  expect(stored.calls).toBe(2)
})

test('Save as copy waits for an older save and preserves a newer draft without resaving the original', async ({ page }) => {
  await ready(page)
  const originalId = await page.evaluate(() => client.record.id)
  await gateStorage(page, 'save')
  await page.evaluate(() => {
    const create = client.library.create
    let releaseCopy
    const copyGate = new Promise(resolve => { releaseCopy = resolve })
    window.releaseCopy = releaseCopy
    window.copyCreates = 0
    client.library.create = async (...args) => {
      window.copyCreates++
      await copyGate
      return create(...args)
    }
    client.document.edit('Draft to copy', data => { data.styles[0].thickness = 13 })
    window.originalSave = client.saveDraft()
  })
  await expect.poll(() => page.evaluate(() => window.storageEntered)).toBe(true)
  await page.evaluate(() => {
    client.document.edit('Newer draft while save is pending', data => { data.styles[0].thickness = 14 })
    window.copyResult = client.saveAsCopy()
  })
  await expect.poll(() => page.evaluate(() => client.editFrozen)).toBe(true)
  expect(await page.evaluate(() => ({ copies: window.copyCreates, id: client.record.id }))).toEqual({ copies: 0, id: originalId })
  await page.evaluate(() => window.releaseStorage())
  expect(await page.evaluate(() => window.originalSave)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.copyCreates)).toBe(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    delete document.hidden
  })
  // Keep copy creation pending long enough for the older save's finally timer
  // and the newer edit's autosave timer to fire if they were not cancelled.
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => ({ saves: window.storageCalls, id: client.record.id, thickness: client.document.snapshot().styles[0].thickness, frozen: client.editFrozen }))).toEqual({ saves: 1, id: originalId, thickness: 14, frozen: true })
  expect((await page.evaluate(id => client.library.load(id), originalId)).payload.styles[0].thickness).toBe(13)
  await page.evaluate(() => window.releaseCopy())
  await page.evaluate(() => window.copyResult)
  await expect(page.locator('#save-status')).toHaveText('Saved')
  const copyId = await page.evaluate(() => client.record.id)
  expect(copyId).not.toBe(originalId)
  expect(await page.evaluate(() => window.copyCreates)).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('dotgrid:last-project'))).toBe(copyId)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => ({ id: client.record.id, saves: window.storageCalls }))).toEqual({ id: copyId, saves: 1 })
  const stored = await page.evaluate(async ids => ({ original: await client.library.load(ids.original), copy: await client.library.load(ids.copy), count: (await client.library.list()).length }), { original: originalId, copy: copyId })
  expect(stored.original.payload.styles[0].thickness).toBe(13)
  expect(stored.original.revision).toBe(2)
  expect(stored.copy.payload.styles[0].thickness).toBe(14)
  expect(stored.copy.revision).toBe(1)
  expect(stored.count).toBe(2)
  await page.evaluate(() => client.document.edit('Edit the copy', data => { data.styles[0].thickness = 15 }))
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect((await page.evaluate(id => client.library.load(id), originalId)).payload.styles[0].thickness).toBe(13)
  expect((await page.evaluate(id => client.library.load(id), copyId)).payload.styles[0].thickness).toBe(15)
  expect(await page.evaluate(() => ({ id: client.record.id, saves: window.storageCalls }))).toEqual({ id: copyId, saves: 2 })
})

test('recovered artwork remains unsaved through reload and Stay until Save recovery explicitly persists it', async ({ page }) => {
  await ready(page)
  const recovery = await page.evaluate(async () => {
    client.document.edit('Known good snapshot', data => {
      data.styles[0].thickness = 7
      data.layers[0] = [{ type: 'line', vertices: [{ x: -15, y: 15 }, { x: 45, y: 60 }] }]
    })
    await client.checkpoint()
    const goodPayload = client.document.snapshot()
    client.document.edit('Newest snapshot', data => {
      data.styles[0].thickness = 11
      data.layers[0][0].vertices[1].x = 75
    })
    await client.checkpoint()
    const newest = client.record
    await new Promise((resolve, reject) => {
      const tx = client.library._db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put({ ...newest, payload: { broken: true } })
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    return { id: newest.id, revision: newest.revision, goodPayload }
  })
  await page.addInitScript(() => {
    window.projectWrites = 0
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects') window.projectWrites++
      return put.apply(this, args)
    }
  })
  await page.reload()
  await page.evaluate(() => client.ready)
  await expect(page.locator('#save-status')).toHaveText('Recovered · not saved')
  await expect(page.locator('#notice')).toContainText('previous good snapshot')
  expect(await page.evaluate(() => client.document.snapshot())).toEqual(recovery.goodPayload)
  expect(await page.evaluate(() => ({ pending: client.recoveryPending, undo: client.document.history.canUndo, saved: client.savedDocumentRevision }))).toEqual({ pending: true, undo: false, saved: -1 })
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => client.saveDraft())).toBe(false)

  const raw = () => page.evaluate(id => new Promise((resolve, reject) => {
    const tx = client.library._db.transaction('projects', 'readonly')
    const request = tx.objectStore('projects').get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }), recovery.id)
  expect((await raw()).payload).toEqual({ broken: true })
  expect(await page.evaluate(() => window.projectWrites)).toBe(0)
  await page.locator('#projects').click()
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Save recovered artwork?')
  await page.getByRole('button', { name: 'Stay', exact: true }).click()
  await expect(page.locator('#save-status')).toHaveText('Recovered · not saved')
  expect(await page.evaluate(() => client.document.snapshot())).toEqual(recovery.goodPayload)
  expect((await raw()).payload).toEqual({ broken: true })
  expect(await page.evaluate(() => window.projectWrites)).toBe(0)

  await page.locator('#projects').click()
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await page.getByRole('button', { name: 'Save recovery', exact: true }).click()
  await expect(page.locator('#save-status')).toHaveText('Saved')
  const repaired = await raw()
  expect(repaired.revision).toBe(recovery.revision + 1)
  expect(repaired.payload).toEqual(recovery.goodPayload)
  expect(repaired.previous.revision).toBe(recovery.revision - 1)
  expect(await page.evaluate(() => ({ pending: client.recoveryPending, writes: window.projectWrites }))).toEqual({ pending: false, writes: 1 })
  await page.reload()
  await page.evaluate(() => client.ready)
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect(await page.evaluate(() => client.document.snapshot())).toEqual(recovery.goodPayload)
  expect(await page.evaluate(() => client.record.recovered)).toBe(false)
})

test('failed copy creation preserves the newer draft and reports that it is not saved', async ({ page }) => {
  await ready(page)
  const originalId = await page.evaluate(() => client.record.id)
  await gateStorage(page, 'save')
  await page.evaluate(() => {
    client.document.edit('First revision', data => { data.styles[0].thickness = 13 })
    window.originalSave = client.saveDraft()
  })
  await expect.poll(() => page.evaluate(() => window.storageEntered)).toBe(true)
  await page.evaluate(() => {
    client.document.edit('Newer revision', data => { data.styles[0].thickness = 14 })
    client.library.create = async () => { throw new Error('Copy storage unavailable') }
    window.failedCopy = client.saveAsCopy()
  })
  await page.evaluate(() => window.releaseStorage())
  await page.evaluate(() => window.failedCopy)
  await expect(page.locator('#save-status')).toHaveText('Save failed')
  expect(await page.evaluate(() => ({ id: client.record.id, value: client.tool.style().thickness, frozen: client.editFrozen }))).toEqual({ id: originalId, value: 14, frozen: false })
  expect((await page.evaluate(id => client.library.load(id), originalId)).payload.styles[0].thickness).toBe(13)
  expect(await page.evaluate(async () => ProjectLibrary.validate(await (await client.manager.prepare('grid')).text()).styles[0].thickness)).toBe(14)
})
