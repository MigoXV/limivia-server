import { test, expect } from '@playwright/test'
import { reset, connect, acquire, openResource } from './helpers'

test('导航以固件上报能力显示状态，设备上下文可重新打开连接详情', async ({ page }) => {
  await reset(page)
  const nav = page.getByRole('navigation', { name: '工作台导航' })
  for (const name of ['外设调试', '离线流程', '联网通信', '板上文件', '设备维护']) {
    await expect(nav.getByRole('button', { name, exact: true })).toBeDisabled()
    await expect(nav.getByRole('button', { name, exact: true })).toContainText('待识别')
  }
  await connect(page, 'signal')
  await expect(nav.getByRole('button', { name: '联网通信', exact: true })).toBeDisabled()
  await expect(nav.getByRole('button', { name: '联网通信', exact: true })).toContainText('未提供')
  // The fixture reports file/flow support for signal: never copy a static design's disabled state.
  await expect(nav.getByRole('button', { name: '板上文件', exact: true })).toBeEnabled()
  await expect(nav.getByRole('button', { name: '离线流程', exact: true })).toBeEnabled()
  await expect(nav.locator('.identity-tag')).toHaveText('signal · 0.3.0-dev')
  await nav.getByRole('button', { name: '连接详情', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '连接设备', exact: true })).toBeVisible()
})

test('侧栏外设草稿和真实资源共享选择，导航不重复创建资源', async ({ page }) => {
  await reset(page)
  await connect(page)
  await acquire(page)
  await openResource(page, 'PWM')
  await page.getByRole('combobox', { name: '引脚 *', exact: true }).selectOption('4')
  await page.getByRole('navigation').getByRole('button', { name: '外设调试', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '引脚 *', exact: true })).toHaveValue('4')
  const resources = page.getByLabel('当前外设资源', { exact: true })
  await expect(resources.getByRole('button', { name: /PWM · 配置草稿/ })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await page.getByRole('combobox', { name: '引脚 *', exact: true }).selectOption('4')
  await page.getByRole('button', { name: '检查引脚与资源', exact: true }).click()
  await expect(page.getByText('当前预检通过；资源尚未预留。')).toBeVisible()
  await page.getByRole('button', { name: '创建PWM', exact: true }).click()
  await expect(page.getByRole('heading', { name: /#\d+ · PWM/ })).toBeVisible()
  const resource = resources.getByRole('button', { name: /PWM · GPIO 4/ })
  await expect(resource).toContainText('本页面创建')
  await expect(resources.getByRole('button', { name: /配置草稿/ })).toHaveCount(0)
  await page
    .getByLabel('外设功能', { exact: true })
    .getByRole('button', { name: 'PWM', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '外设调试', level: 1 })).toBeVisible()
  await resource.click()
  await expect(page.getByRole('heading', { name: '调试 PWM', level: 2 })).toBeVisible()
  await expect(resource).toHaveAttribute('aria-current', 'location')
  const commands = (await (await page.request.get('/api/testing/commands')).json()).commands
  expect(commands.filter((command: { op: string }) => command.op === 'resource.open')).toHaveLength(
    1,
  )
  for (const theme of ['vallum', 'abyssus']) {
    if (theme === 'abyssus') await page.getByRole('button', { name: '切换苍渊' }).click()
    const images = navImages(page)
    expect(await images.count()).toBeGreaterThan(0)
    for (const image of await images.all()) {
      await expect(image).toHaveJSProperty('naturalWidth', 16)
      const box = await image.boundingBox()
      expect(box?.width).toBe(16)
      expect(box?.height).toBe(16)
    }
  }
})
function navImages(page: import('@playwright/test').Page) {
  return page.locator('.nav-icon img:visible')
}
