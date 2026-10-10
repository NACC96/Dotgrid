const { test, expect } = require('@playwright/test')
test('editor starts with a canvas and three layers', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await expect(page.locator('canvas#guide')).toBeVisible()
  await expect.poll(() => page.evaluate(() => client.tool.layers.length)).toBe(3)
  expect(errors).toEqual([])
})
