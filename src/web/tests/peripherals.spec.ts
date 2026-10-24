import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { reset, connect, acquire } from './helpers'
test.beforeEach(async ({ page }) => {
  await reset(page)
  await connect(page)
  await page.getByRole('navigation').getByRole('button', { name: '外设调试', exact: true }).click()
})
test('统一整行选择，不可用项默认折叠，选择不执行硬件命令', async ({ page }) => {
  const list = page.getByLabel('外设功能', { exact: true })
  const detail = page.getByLabel('外设详情', { exact: true })
  await expect(page.getByRole('button', { name: '外设目录', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打开', exact: true })).toHaveCount(0)
  await expect(list.getByRole('button', { name: '板载 LED', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(detail.getByRole('region', { name: '板载 LED 快捷控制' })).toBeVisible()
  const fold = list.locator('details')
  await expect(fold).not.toHaveAttribute('open', '')
  const unavailable = await fold.locator('.peripheral-unavailable-entry').count()
  expect(unavailable).toBeGreaterThan(0)
  await expect(fold.getByRole('group')).toHaveCount(0)
  await fold
    .getByRole('button')
    .count()
    .then((count) => expect(count).toBe(0))
  await fold.locator('summary').click()
  await expect(fold.locator('.peripheral-unavailable-entry').first()).toBeVisible()
  await fold.locator('summary').click()
  const before = (await (await page.request.get('/api/testing/commands')).json()).commands.length
  const pwm = list.getByRole('button', { name: 'PWM', exact: true })
  const box = (await pwm.boundingBox())!
  await pwm.click({ position: { x: box.width - 5, y: box.height - 5 } })
  await expect(pwm).toHaveAttribute('aria-pressed', 'true')
  await expect(detail.getByRole('heading', { name: '新建 PWM 外设', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '引脚 *', exact: true }).selectOption('4')
  await pwm.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: '引脚 *', exact: true })).toHaveValue('4')
  await list.getByRole('button', { name: 'GPIO', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(list.getByRole('button', { name: 'GPIO', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const commands = (await (await page.request.get('/api/testing/commands')).json()).commands.slice(
    before,
  )
  expect(commands.some((command: { op: string }) => command.op.startsWith('resource.'))).toBe(false)
})
for (const width of [1280, 1440])
  for (const theme of ['vallum', 'abyssus'])
    test(`目录与详情局部滚动 · ${theme} · ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
      if (theme === 'abyssus') await page.getByRole('button', { name: '切换苍渊' }).click()
      await page.evaluate(() => document.fonts.ready)
      const measure = () =>
        page.evaluate(() =>
          Object.fromEntries(
            ['.topbar', '.peripherals-main > .page-heading', '.diagnostic-bar'].map((selector) => {
              const box = document.querySelector(selector)!.getBoundingClientRect()
              return [selector, { y: box.y, h: box.height }]
            }),
          ),
        )
      const before = await measure()
      const list = page.getByLabel('外设功能', { exact: true })
      expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      )
      await list.hover()
      await page.mouse.wheel(0, 700)
      await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      expect(await measure()).toEqual(before)
      await list.getByRole('button', { name: 'GPIO', exact: true }).click()
      const detail = page.getByLabel('外设详情', { exact: true })
      await detail.getByText('设备原始能力描述', { exact: true }).click()
      await detail.hover()
      await page.mouse.wheel(0, 1000)
      await expect.poll(() => detail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      expect(await measure()).toEqual(before)
      expect(await page.getByRole('main').evaluate((element) => element.scrollTop)).toBe(0)
      await list.getByRole('button', { name: '板载 LED', exact: true }).click()
      expect(await detail.evaluate((element) => element.scrollTop)).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([])
      await page.screenshot({ path: testInfo.outputPath('peripheral-led.png') })
    })
test('外设页 LED 复用最近确认输出与固定反馈', async ({ page }) => {
  await acquire(page)
  const led = page.getByRole('region', { name: '板载 LED 快捷控制' })
  await led.getByRole('button', { name: '点亮 LED', exact: true }).click()
  await expect(led.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  await led.getByRole('button', { name: '熄灭 LED', exact: true }).click()
  await expect(led.getByRole('heading', { name: '已熄灭', exact: true })).toBeVisible()
  await expect(led.getByLabel('LED 操作反馈', { exact: true })).toHaveCSS('height', '40px')
})
for (const layout of [
  { width: 320, zoom: 1 },
  { width: 768, zoom: 1 },
  { width: 1280, zoom: 2 },
])
  test(`窄屏与放大仍可进入功能和访问详情 · ${layout.width} · ${layout.zoom}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: layout.width, height: 900 })
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = String(zoom)
    }, layout.zoom)
    const list = page.getByLabel('外设功能', { exact: true })
    await list.getByRole('button', { name: 'PWM', exact: true }).click()
    await expect(page.getByRole('heading', { name: '新建 PWM 外设', exact: true })).toBeVisible()
    await page
      .getByLabel('外设详情', { exact: true })
      .getByText('设备原始能力描述', { exact: true })
      .click()
    await page.getByRole('button', { name: '检查引脚与资源', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await list.getByRole('button', { name: '板载 LED', exact: true }).click()
    await page.getByRole('button', { name: '读取状态', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('peripheral-responsive.png'),
      fullPage: true,
    })
  })
