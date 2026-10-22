import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { installDevice } from './simulated-device'
import { connectDevice, openConnection, openResources } from './helpers'

for (const width of [320, 768, 1280]) {
  test(`Figma workbench: screens, local assets and overlays at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const device = await installDevice(page, 'ble')
    await page.goto('/')
    await page.screenshot({ path: `../../artifacts/figma-sync/led-${width}.png`, fullPage: true })
    for (const image of await page.locator('nav img').all()) {
      await expect(image).toHaveJSProperty('complete', true)
      const geometry = await image.evaluate((element) => {
        const img = element as HTMLImageElement
        return {
          natural: [img.naturalWidth, img.naturalHeight],
          actual: [img.width, img.height],
          src: img.src,
        }
      })
      expect(geometry.natural).toEqual([16, 16])
      expect(geometry.actual).toEqual([16, 16])
      expect(geometry.src).not.toContain('figma.com')
    }
    await openConnection(page)
    await page.screenshot({
      path: `../../artifacts/figma-sync/connection-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await connectDevice(page)
    for (const [id, name] of [
      ['gpio', '数字引脚'],
      ['pwm', 'PWM 调制'],
      ['adc', '模拟采集'],
      ['timer', '本地定时'],
    ]) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.getByLabel('目标引脚').selectOption(id === 'gpio' ? '3' : id === 'pwm' ? '4' : '0')
      if (id === 'gpio') await page.getByRole('button', { name: '应用输入配置' }).click()
      if (id === 'pwm') {
        await page.getByRole('button', { name: '启动 PWM' }).click()
        await expect(page.getByRole('button', { name: '应用修改' })).toBeEnabled()
        await page.getByLabel('输出频率').fill('1200')
        await page.getByLabel('占空比').fill('60')
        await expect(page.locator('.operation-feedback')).toContainText('有未应用修改')
      }
      if (id === 'adc') {
        await page.getByRole('button', { name: '开始采样' }).click()
        await expect(page.getByRole('heading', { name: '采样中' })).toBeVisible()
        for (let index = 0; index < 40; index++)
          device.sample(0, 2000 + index, Math.round(1248 + Math.sin(index / 5) * 400))
        await expect(page.getByRole('img', { name: /最近 41 个 ADC 电压/ })).toBeVisible()
        await expect(page.locator('.chart-scale')).toHaveCSS('font-size', '11px')
        const tick = await page.locator('.chart-scale span').first().boundingBox()
        expect(tick?.width).toBeGreaterThan(24)
      }
      if (id === 'timer') {
        await page.getByLabel('目标引脚').selectOption('13')
        await page.getByRole('button', { name: '启动本地任务' }).click()
        await expect(page.locator('.task-row')).toHaveCount(1)
      }
      await expect(page.locator('.operation-feedback')).not.toContainText('已提交请求')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const audit = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
      expect(
        audit.violations.map((item) => ({
          id: item.id,
          targets: item.nodes.map((node) => node.target),
        })),
      ).toEqual([])
      await page.screenshot({
        path: `../../artifacts/figma-sync/${id}-${width}.png`,
        fullPage: true,
      })
      if (id === 'gpio') {
        await page.getByRole('button', { name: '输出', exact: true }).click()
        await expect(page.getByRole('heading', { name: '设备当前读数' })).toBeVisible()
        await expect(page.locator('.gpio-reading')).toContainText('工作模式尚未应用')
        await page.screenshot({
          path: `../../artifacts/figma-sync/gpio-draft-${width}.png`,
          fullPage: true,
        })
      }
    }
    await page.getByRole('button', { name: '当前实验帮助' }).click()
    await expect(page.getByRole('dialog')).toContainText('任务在芯片端执行')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '当前实验帮助' })).toBeFocused()
    await page.getByRole('button', { name: '板载 LED', exact: true }).click()
    const resources = await openResources(page)
    const board = resources.getByRole('img')
    await expect(board).toHaveJSProperty('naturalWidth', 250)
    await expect(board).toHaveJSProperty('naturalHeight', 313)
    const rect = await board.boundingBox()
    expect([rect?.width, rect?.height]).toEqual([250, 313])
    await page.screenshot({
      path: `../../artifacts/figma-sync/resources-${width}.png`,
      fullPage: true,
    })
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
        .violations,
    ).toEqual([])
    await resources.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: /命令与事件/ }).click()
    await expect(page.getByRole('dialog')).toContainText('timer.start')
    await page.screenshot({ path: `../../artifacts/figma-sync/logs-${width}.png`, fullPage: true })
    expect(errors).toEqual([])
  })
}

test('offline presets stay editable and invalid drafts do not prevent stopping ADC', async ({
  page,
}) => {
  await installDevice(page, 'ble')
  await page.goto('/')
  await page.getByRole('button', { name: 'PWM 调制', exact: true }).click()
  await page.getByLabel('输出频率').fill('2000')
  await expect(page.getByRole('button', { name: '启动 PWM' })).toBeDisabled()
  await connectDevice(page)
  await expect(page.getByLabel('输出频率')).toHaveValue('2000')
  await page.getByRole('button', { name: '模拟采集', exact: true }).click()
  await page.getByRole('button', { name: '开始采样' }).click()
  await expect(page.getByRole('heading', { name: '采样中' })).toBeVisible()
  await page.getByLabel('采样间隔').fill('')
  await page.getByRole('button', { name: '停止采样' }).click()
  await expect(page.getByRole('heading', { name: '已停止', exact: true })).toBeVisible()
})
