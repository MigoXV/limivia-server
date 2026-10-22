import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installDevice } from './simulated-device'
import { connectDevice, openWiring } from './helpers'

for (const width of [320, 768, 1280]) {
  test(`实物接线图在 ${width}px 可查看、翻面及键盘关闭`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    await openWiring(page)
    const board = page.locator('.wiring-dialog .board-wrap > svg')
    await expect(board.locator('[data-pin-id]')).toHaveCount(32)
    await expect(board.locator('.selected-pin')).toHaveAttribute('data-pin-id', 'L10')
    await page.getByRole('button', { name: '放大接线图' }).click()
    const dialog = page.locator('.board-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-pin-id]')).toHaveCount(32)
    await expect(dialog.locator('[data-pin-id="L10"]')).toHaveAttribute('data-side', 'left')
    await dialog.getByRole('button', { name: '背面', exact: true }).click()
    await expect(dialog.locator('[data-pin-id="L10"]')).toHaveAttribute('data-side', 'right')
    await dialog.locator('[data-pin-id="R3"]').focus()
    await page.keyboard.press('Enter')
    await expect(dialog.locator('.board-detail')).toContainText('启动配置／受保护')
    await expect(dialog.locator('[data-pin-id="R3"]')).toHaveAttribute('data-category', 'analog')
    await dialog.locator('[data-pin-id="R11"]').click()
    await expect(dialog.locator('.board-detail')).toContainText('ADC2 当前未开放')
    await expect(dialog.locator('.selected-pin')).toHaveAttribute('data-pin-id', 'L10')
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    await dialog.getByRole('button', { name: '正面', exact: true }).click()
    await page.screenshot({ path: `../../artifacts/board-expanded-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: '放大接线图' })).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('查看引脚不发送设备命令且五类颜色正确', async ({ page }) => {
  const device = await installDevice(page, 'ble')
  await page.goto('/')
  await connectDevice(page)
  await openWiring(page)
  expect(device.commands.length).toBeGreaterThan(0)
  const before = [...device.commands]
  const board = page.locator('.wiring-dialog .board-wrap > svg')
  for (const [id, color] of [
    ['L16', 'rgb(220, 38, 38)'],
    ['L1', 'rgb(17, 17, 17)'],
    ['L13', 'rgb(234, 179, 8)'],
    ['L2', 'rgb(37, 99, 235)'],
    ['L10', 'rgb(22, 163, 74)'],
  ]) {
    const pin = board.locator(`[data-pin-id="${id}"]`)
    await pin.click()
    await expect(pin.locator('.pin-pad')).toHaveCSS('fill', color)
  }
  await page.getByRole('button', { name: '背面', exact: true }).click()
  expect(device.commands).toEqual(before)
})
