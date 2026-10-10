'use strict'
const { test, expect } = require('@playwright/test')
async function ready(page){await page.goto('/');await page.evaluate(()=>client.ready)}
async function edit(page,label='test'){await page.evaluate(label=>client.document.edit(label,data=>data.styles[0].thickness++),label)}
test('saved revision restores after reload; stale completion never declares a newer edit Saved', async({page})=>{
  await ready(page)
  await page.evaluate(()=>{
    const original=client.library.save
    let release
    window.saveGate=new Promise(resolve=>{release=resolve});window.releaseSave=release
    client.library.save=async(...args)=>{await window.saveGate;return original(...args)}
  })
  await edit(page,'first');await page.waitForTimeout(70);await edit(page,'second')
  await expect(page.locator('#save-status')).toHaveText('Saving')
  await page.evaluate(()=>window.releaseSave())
  await expect(page.locator('#save-status')).toHaveText('Saved')
  expect(await page.evaluate(()=>client.record.payload.styles[0].thickness)).toBe(5)
  await page.reload();await page.evaluate(()=>client.ready)
  expect(await page.evaluate(()=>client.tool.style().thickness)).toBe(5)
  expect(await page.evaluate(()=>client.document.history.canUndo)).toBe(false)
})
test('failed switch and exporting backup keep dirty draft; explicit discard permits leaving',async({page})=>{
  await ready(page)
  await page.evaluate(()=>{client.library.save=async()=>{const error=new Error('Injected quota failure');error.code='QUOTA_EXCEEDED';throw error}})
  await edit(page)
  await expect(page.locator('#save-status')).toHaveText('Save failed')
  await page.evaluate(()=>{window.leaveResult=client.canLeave()})
  await page.getByRole('button',{name:'Export backup',exact:true}).click()
  await page.getByRole('button',{name:'Prepare .grid',exact:true}).click()
  await expect(page.getByRole('button',{name:'Download',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Done',exact:true}).click()
  expect(await page.evaluate(()=>window.leaveResult)).toBe(false)
  expect(await page.evaluate(()=>client.tool.style().thickness)).toBe(4)
  await page.evaluate(()=>{window.leaveResult=client.canLeave()})
  await page.getByRole('button',{name:'Discard draft',exact:true}).click()
  expect(await page.evaluate(()=>window.leaveResult)).toBe(true)
})
test('two editors conflict and copy preserves the local draft without overwriting original',async({page,context})=>{
  await ready(page);const other=await context.newPage();await ready(other)
  await edit(page,'first');await expect(page.locator('#save-status')).toHaveText('Saved')
  await edit(other,'second');await expect(other.locator('#save-status')).toHaveText('Conflict')
  await other.evaluate(()=>client.saveAsCopy())
  await expect(other.locator('#save-status')).toHaveText('Saved')
  expect(await other.evaluate(()=>client.library.list().then(records=>records.length))).toBe(2)
  expect(await page.evaluate(()=>client.record.id)).not.toBe(await other.evaluate(()=>client.record.id))
  await other.close()
})
test('renaming the current project cannot adopt another editor’s revision behind an unchanged local draft',async({page})=>{
  await ready(page)
  const original=await page.evaluate(async()=>{
    const remote=new ProjectLibrary();const payload=client.document.snapshot();payload.styles[0].thickness=19
    await remote.save(client.record.id,client.projectName,payload,client.record.revision);remote.close();return {id:client.record.id,name:client.projectName}
  })
  await page.locator('#projects').click();await page.getByRole('button',{name:'Rename',exact:true}).click()
  await page.getByLabel('Name',{exact:true}).fill('Renamed')
  await page.getByRole('dialog').getByRole('button',{name:'Rename',exact:true}).click()
  await expect(page.locator('#notice')).toContainText('changed in another editor')
  const saved=await page.evaluate(id=>client.library.load(id),original.id)
  expect(saved.name).toBe(original.name);expect(saved.payload.styles[0].thickness).toBe(19)
  await edit(page);await expect(page.locator('#save-status')).toHaveText('Conflict')
})
