import { test, expect } from '@playwright/test'

for (const width of [320, 768, 1280]) {
  test(`disconnected workspace at ${width}px is honest and fits viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await expect(page.getByText('等待连接', { exact: true })).toBeVisible()
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

test('canceled device selection is recoverable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      value: {
        requestPort: async () => {
          throw new DOMException('cancel', 'NotFoundError')
        },
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '连接设备' }).click()
  await expect(page.getByRole('alert')).toContainText('已取消设备选择')
  await expect(page.getByRole('button', { name: '连接设备' })).toBeEnabled()
})

test('unsupported APIs expose actionable guidance and keyboard skip link', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { bluetooth?: unknown }).bluetooth
  })
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '跳至工作区' })).toBeFocused()
  await page.getByLabel('连接方式').selectOption('ble')
  await expect(page.getByText(/当前环境不支持/)).toBeVisible()
  await expect(page.getByRole('button', { name: '连接设备' })).toBeDisabled()
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
  await expect(page.getByRole('button', { name: '停止全部输出' })).toBeVisible()
})
