import { test, expect } from '@playwright/test'
import { openConnection, openResources } from './helpers'

for (const width of [320, 768, 1280]) {
  test(`disconnected workspace at ${width}px is honest and fits viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.locator('.connection-status')).toHaveText('未连接')
    await expect(page.getByRole('button', { name: '点亮 LED', exact: true })).toBeDisabled()
    for (const name of ['数字引脚', 'PWM 调制', '模拟采集', '本地定时', '板载 LED']) {
      await page
        .getByRole('button', { name: new RegExp(name) })
        .first()
        .click()
      await expect(page.locator('#experiment-title')).toHaveText(name)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    }
    await page.screenshot({ path: `../../artifacts/workspace-${width}.png`, fullPage: true })
  })
}

test('backend discovery failure and empty results are recoverable', async ({ page }) => {
  let attempt = 0
  await page.route('**/api/device/discover?*', async (route) => {
    attempt++
    if (attempt === 1)
      await route.fulfill({ status: 503, json: { detail: '后端蓝牙不可用，请检查适配器。' } })
    else await route.fulfill({ json: { kind: 'ble', devices: [] } })
  })
  await page.goto('/')
  await openConnection(page)
  await expect(
    page
      .getByRole('group', { name: '连接方式', exact: true })
      .getByRole('button', { name: 'BLE 蓝牙' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '连接所选设备' })).toBeDisabled()
  await page.getByRole('button', { name: '搜索设备' }).click()
  await expect(page.getByRole('alert')).toContainText('后端蓝牙不可用')
  await expect(page.getByRole('button', { name: '搜索设备' })).toBeEnabled()
  await page.getByRole('button', { name: '搜索设备' }).click()
  await expect(page.getByText(/未发现设备/)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('backend Bluetooth works without browser hardware APIs and supports reconnection', async ({
  page,
}) => {
  const { installDevice } = await import('./simulated-device')
  const device = await installDevice(page, 'ble')
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { bluetooth?: unknown }).bluetooth
    delete (Navigator.prototype as unknown as { serial?: unknown }).serial
  })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '跳至工作区' })).toBeFocused()
  await openConnection(page)
  await expect(
    page
      .getByRole('group', { name: '连接方式', exact: true })
      .getByRole('button', { name: 'BLE 蓝牙' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '搜索设备' }).click()
  await page.getByRole('button', { name: '连接所选设备' }).click()
  await expect(page.locator('.connection-status')).toHaveText('已连接')
  device.disconnect()
  await expect(page.locator('.connection-status')).toHaveText('连接已丢失')
  await expect(page.getByRole('button', { name: '点亮 LED', exact: true })).toBeDisabled()
  await openConnection(page)
  await page.getByRole('button', { name: '连接所选设备' }).click()
  await expect(page.locator('.connection-status')).toHaveText('已连接')
})

test('multiple backend devices require selection and switching transport clears it', async ({
  page,
}) => {
  await page.route('**/api/device/discover?*', async (route) => {
    await route.fulfill({
      json: {
        kind: 'ble',
        devices: [
          { id: 'one', name: 'LIMIVIA one' },
          { id: 'two', name: 'LIMIVIA two' },
        ],
      },
    })
  })
  await page.goto('/')
  await openConnection(page)
  await page.getByRole('button', { name: '搜索设备' }).click()
  await expect(page.getByLabel('后端设备')).toBeVisible()
  await expect(page.getByRole('button', { name: '连接所选设备' })).toBeDisabled()
  await page.getByLabel('后端设备').selectOption('two')
  await expect(page.getByRole('button', { name: '连接所选设备' })).toBeEnabled()
  await page
    .getByRole('group', { name: '连接方式', exact: true })
    .getByRole('button', { name: 'BLE 蓝牙' })
    .locator('..')
    .getByRole('button', { name: 'USB', exact: true })
    .click()
  await expect(page.getByLabel('后端设备')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '连接所选设备' })).toBeDisabled()
})

test('workbench accessibility and 200% text zoom', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/')
  for (const name of ['板载 LED', '数字引脚', 'PWM 调制', '模拟采集', '本地定时']) {
    await page
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click()
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      audit.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([])
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2'
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const resources = await openResources(page)
  await expect(resources.getByRole('button', { name: '停止全部输出…' })).toBeVisible()
})

test('backend connection errors allow retry', async ({ page }) => {
  const { installDevice } = await import('./simulated-device')
  await installDevice(page, 'ble')
  await page.routeWebSocket('**/api/device/connect?*', (ws) => {
    ws.send(
      JSON.stringify({ type: 'error', message: '后端设备正被其他页面使用，请先断开原连接。' }),
    )
    ws.close()
  })
  await page.goto('/')
  await openConnection(page)
  await page.getByRole('button', { name: '搜索设备' }).click()
  await page.getByRole('button', { name: '连接所选设备' }).click()
  await expect(page.getByRole('alert')).toContainText('其他页面使用')
  await expect(page.getByRole('button', { name: '连接所选设备' })).toBeEnabled()
})

test('device selector and connected controls fit narrow viewports', async ({ page }) => {
  const { installDevice } = await import('./simulated-device')
  await installDevice(page, 'ble')
  await page.goto('/')
  await openConnection(page)
  await page.getByRole('button', { name: '搜索设备' }).click()
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: `../../artifacts/device-selection-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 320, height: 1000 })
  await page.getByRole('button', { name: '连接所选设备' }).click()
  await expect(page.locator('.connection-status')).toHaveText('已连接')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([])
  await page.screenshot({ path: '../../artifacts/backend-ble-connected-320.png', fullPage: true })
})
