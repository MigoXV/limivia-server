import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { reset, connect, selectPin, openResource } from './helpers'

const protectedPins = [
  ['R3', 'IO02', '启动配置'],
  ['R13', 'IO08', '启动配置'],
  ['R14', 'IO09', 'BOOT'],
  ['R8', 'IO11', 'Flash 电压'],
  ['L4', 'IO12', 'D4 系统状态 LED'],
  ['L5', 'IO18', 'USB D−'],
  ['L6', 'IO19', 'USB D+'],
]

test('保护脚可用键盘查看原因，普通供电与 ADC2 未开放不误标，查看不写设备', async ({ page }) => {
  await reset(page)
  await connect(page)
  const before = (await (await page.request.get('/api/testing/commands')).json()).commands.length
  for (const [id, label, reason] of protectedPins) {
    const pin = page.locator(`.board-stage svg.board [data-pin-id="${id}"]`).first()
    await pin.focus()
    await page.keyboard.press(id === 'R8' ? 'Space' : 'Enter')
    await expect(page.locator('.board-inspector .inspector-identity h2')).toContainText(label)
    await expect(page.locator('.board-inspector')).toContainText(reason)
    await expect(
      page.getByRole('heading', { name: '受保护 · 不可配置', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.pin-functions button')).toHaveCount(0)
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(pin).not.toHaveAttribute('aria-disabled', 'true')
  }
  await selectPin(page, 'L1')
  await expect(page.getByRole('heading', { name: '此位置仅查看信息' })).toBeVisible()
  await selectPin(page, 'R11')
  await expect(page.locator('.board-inspector')).toContainText('ADC2 当前未开放，数字功能可用')
  await expect(page.locator('.pin-functions').getByRole('button', { name: /^GPIO/ })).toBeVisible()
  await openResource(page, 'GPIO')
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  await expect(
    page.locator('.board-stage .assigned-pin:visible .pin-protection-hatch'),
  ).toHaveCount(0)
  const commands = (await (await page.request.get('/api/testing/commands')).json()).commands.slice(
    before,
  )
  expect(
    commands.filter((c: { op: string }) =>
      ['resource.open', 'resource.call', 'control.acquire'].includes(c.op),
    ),
  ).toEqual([])
})

for (const theme of ['vallum', 'abyssus'])
  for (const layout of [
    { width: 1440, zoom: 1 },
    { width: 320, zoom: 1 },
    { width: 1280, zoom: 2 },
  ])
    test(`保护纹理正反面与放大图 · ${theme} · ${layout.width} · ${layout.zoom}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: layout.width, height: 1000 })
      await reset(page)
      await connect(page)
      if (theme === 'abyssus') await page.getByRole('button', { name: '切换苍渊' }).click()
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom)
      }, layout.zoom)
      const back = page.getByRole('button', { name: '← 返回板卡', exact: true })
      if (await back.isVisible()) await back.click()
      const wrap = page.locator('.board-stage .board-wrap')
      const board = wrap.locator('> .board-viewport > svg.board')
      await wrap.locator('> .board-legend .board-protection-legend').scrollIntoViewIfNeeded()
      await expect(wrap.locator('> .board-legend .board-protection-legend')).toBeInViewport()
      for (const face of ['正面', '背面']) {
        await wrap
          .locator('> .board-toolbar .board-controls-row')
          .getByRole('button', { name: face, exact: true })
          .click()
        await expect(board.locator('.pin-protection-hatch')).toHaveCount(7)
        expect(
          await board
            .locator('.pin-protection-hatch')
            .evaluateAll((nodes) =>
              nodes.map((n) => n.parentElement!.getAttribute('data-pin-id')).sort(),
            ),
        ).toEqual(protectedPins.map((p) => p[0]).sort())
        for (const id of ['L1', 'L13', 'R11', 'R12', 'L10'])
          await expect(board.locator(`[data-pin-id="${id}"] .pin-protection-hatch`)).toHaveCount(0)
        const pin = board.locator('[data-pin-id="R8"]')
        await pin.hover()
        await pin.focus()
        await expect(pin).toBeFocused()
        await expect(pin.locator('.pin-protection-hatch')).toBeVisible()
        await board.screenshot({ path: info.outputPath(`${face}-hatch.png`) })
      }
      await wrap.getByRole('button', { name: '放大接线图', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '实物接线图 · 32 引脚', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.pin-protection-hatch')).toHaveCount(7)
      const ids = await page
        .locator('svg.board pattern')
        .evaluateAll((nodes) => nodes.map((n) => n.id))
      expect(new Set(ids).size).toBe(ids.length)
      expect(
        await dialog.locator('.pin-protection-hatch').evaluateAll((nodes) =>
          nodes.every((n) => {
            const id = n.getAttribute('fill')!.slice(5, -1)
            return (
              n.closest('svg')!.querySelectorAll('pattern').length === 1 &&
              document.getElementById(id)?.closest('svg') === n.closest('svg')
            )
          }),
        ),
      ).toBe(true)
      await dialog.locator('[data-pin-id="R8"]').click()
      await expect(dialog.locator('.board-detail')).toContainText('当前查看：IO11 / GPIO 11')
      await expect(dialog.locator('.board-detail')).toContainText('Flash 电压／受保护')
      await expect(dialog.locator('[data-pin-id="R8"] .pin-protection-hatch')).toBeVisible()
      await dialog.screenshot({ path: info.outputPath('expanded-protected.png') })
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        results.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([])
      await page.keyboard.press('Escape')
      if (layout.width === 320 || layout.zoom === 2)
        await expect(page.getByLabel('接线与调试详情', { exact: true })).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    })
