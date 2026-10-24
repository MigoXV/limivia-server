import { test, expect } from '@playwright/test'
import { reset, connect, acquire } from './helpers'

test.beforeEach(async ({ page }) => {
  await reset(page)
  await connect(page)
})

test('首页 LED 开关、只读观察、呼吸切换和详情共享设备状态', async ({ page }) => {
  const led = page.getByRole('region', { name: '板载 LED 快捷控制' })
  await expect(led.getByRole('button', { name: '点亮 LED', exact: true })).toBeDisabled()
  await acquire(page)
  await led.getByRole('button', { name: '点亮 LED', exact: true }).click()
  await expect(led.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '释放设备控制', exact: true }).first().click()
  await expect(page.locator('.control-status')).toHaveText('观察模式')
  const before = (await (await page.request.get('/api/testing/commands')).json()).commands.length
  await led.getByRole('button', { name: '读取状态', exact: true }).click()
  await expect(led.getByText('状态已读取，输出保持不变。')).toBeVisible()
  await expect(led.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  const commands = (await (await page.request.get('/api/testing/commands')).json()).commands.slice(
    before,
  )
  expect(
    commands
      .filter((c: { op: string; params: { action?: string } }) => c.op === 'resource.call')
      .map((c: { params: { action: string } }) => c.params.action),
  ).toEqual(['status'])
  expect(commands.some((c: { op: string }) => c.op === 'control.acquire')).toBe(false)
  await acquire(page)
  await led.getByRole('button', { name: '呼吸演示', exact: true }).click()
  page.once('dialog', (dialog) => dialog.dismiss())
  await led.getByRole('button', { name: '开始呼吸', exact: true }).click()
  await expect(led.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await led.getByRole('button', { name: '开始呼吸', exact: true }).click()
  await expect(led.getByRole('heading', { name: '呼吸运行中', exact: true })).toBeVisible()
  await led.getByRole('button', { name: '读取状态', exact: true }).click()
  await expect(led.getByRole('heading', { name: '呼吸运行中', exact: true })).toBeVisible()
  await led.getByRole('button', { name: '打开 LED 详情', exact: true }).click()
  await expect(page.getByRole('heading', { name: '板载 LED', level: 2 })).toBeVisible()
  await expect(led.getByRole('heading', { name: '呼吸运行中', exact: true })).toBeVisible()
  await led.getByRole('button', { name: '关闭 LED 资源', exact: true }).click()
  await expect(led.getByRole('heading', { name: '未创建 LED 资源', exact: true })).toBeVisible()
})

for (const width of [1280, 1440])
  test(`首页设计尺寸与真实字体 · ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
    await acquire(page)
    await expect(
      page.getByRole('button', { name: '释放设备控制', exact: true }).first(),
    ).toBeEnabled()
    await page.evaluate(() => document.fonts.ready)
    const nav = page.getByRole('navigation')
    await expect(nav.getByRole('button', { name: '设备工作台', exact: true })).toHaveCSS(
      'font-weight',
      '500',
    )
    await expect(nav.getByRole('button', { name: '外设调试', exact: true })).toHaveCSS(
      'font-weight',
      '400',
    )
    const metrics = await page.evaluate(() =>
      Object.fromEntries(
        [
          '.sidebar',
          '.sidebar-navigation .nav-item',
          '.summary-band',
          '.home-led',
          '.home-capabilities > aside',
        ].map((selector) => {
          const r = document.querySelector(selector)!.getBoundingClientRect()
          return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }]
        }),
      ),
    )
    expect(metrics['.sidebar'].width).toBe(240)
    expect(metrics['.sidebar-navigation .nav-item'].y).toBe(155)
    expect(metrics['.summary-band'].y).toBe(116)
    expect(metrics['.summary-band'].height).toBe(64)
    expect(metrics['.home-led'].y).toBe(196)
    expect(metrics['.home-led'].height).toBe(244)
    expect(metrics['.home-capabilities > aside'].width).toBe(256)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument')
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.sidebar-navigation .nav-item.selected',
    })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    expect(fonts.length).toBeGreaterThan(0)
    expect(
      fonts.every((font) => font.isCustomFont && font.familyName.includes('Noto Sans SC')),
    ).toBe(true)
    await testInfo.attach('layout-and-fonts', {
      body: JSON.stringify({ metrics, fonts }, null, 2),
      contentType: 'application/json',
    })
    await page.screenshot({ path: testInfo.outputPath('home-vallum.png') })
    await page.getByRole('button', { name: '切换苍渊' }).click()
    await page.screenshot({ path: testInfo.outputPath('home-abyssus.png') })
  })

test('其他页面创建的 LED 资源只读，取得控制后也不能直接覆盖', async ({ page, context }) => {
  await acquire(page)
  await page.getByRole('button', { name: '点亮 LED', exact: true }).click()
  await expect(page.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '释放设备控制', exact: true }).first().click()
  await expect(page.locator('.control-status')).toHaveText('观察模式')
  const observer = await context.newPage()
  await observer.goto('/')
  await expect(observer.getByRole('heading', { name: '其他来源占用', exact: true })).toBeVisible()
  await acquire(observer)
  await expect(observer.getByRole('button', { name: /^(点亮|熄灭) LED$/ })).toBeDisabled()
  await expect(observer.getByRole('button', { name: '关闭 LED 资源', exact: true })).toBeDisabled()
  await observer.getByRole('button', { name: '读取状态', exact: true }).click()
  await expect(observer.getByRole('button', { name: '读取状态', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
})

test('LED 创建等待确认时禁止重复操作', async ({ page }) => {
  await acquire(page)
  await page.request.post('/api/testing/configure', { data: { hold_jobs: true } })
  await page.getByRole('button', { name: '点亮 LED', exact: true }).click()
  await expect(page.getByRole('heading', { name: '尚未确认输出', exact: true })).toBeVisible()
  const led = page.getByRole('region', { name: '板载 LED 快捷控制' })
  for (const name of ['开关控制', '呼吸演示', '读取状态', '关闭 LED 资源'])
    await expect(led.getByRole('button', { name, exact: true })).toBeDisabled()
  await expect(led.getByRole('button', { name: '点亮 LED', exact: true })).toBeDisabled()
  await page.request.post('/api/testing/configure', { data: { hold_jobs: false } })
  await expect(page.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
  const commands = (await (await page.request.get('/api/testing/commands')).json()).commands
  expect(commands.filter((c: { op: string }) => c.op === 'resource.open')).toHaveLength(1)
})
