import { test, expect } from '@playwright/test'
import { installDevice } from './simulated-device'

for (const kind of ['usb', 'ble'] as const) {
  test(`${kind} adapter: handshake, output, PWM, timer, ADC and disconnect`, async ({ page }) => {
    await installDevice(page, kind)
    await page.goto('/')
    await page.getByLabel('连接方式').selectOption(kind)
    await page.getByRole('button', { name: '连接设备' }).click()
    await expect(page.getByText('设备已就绪', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '点亮 LED', exact: true }).click()
    await expect(page.getByRole('heading', { name: '已点亮', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '释放引脚', exact: true }).click()
    await page.getByRole('button', { name: '呼吸演示' }).click()
    await expect(page.getByRole('heading', { name: '正在呼吸' })).toBeVisible()
    await expect(page.getByRole('button', { name: '点亮 LED', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '停止全部输出' }).click()
    await page.getByRole('button', { name: /本地定时/ }).click()
    await page.getByRole('button', { name: '启动本地任务' }).click()
    await expect(page.locator('.task-row')).toContainText('GPIO 0')
    await page.getByRole('button', { name: '停止', exact: true }).click()
    await expect(page.locator('.task-row')).toHaveCount(0)
    await page.getByRole('button', { name: /模拟采集/ }).click()
    await page.getByRole('button', { name: '读取一次' }).click()
    await expect(page.locator('.adc-readings')).toContainText('2048')
    await expect(page.locator('.adc-readings')).toContainText('1500')
    await page.getByRole('button', { name: '断开连接', exact: true }).click()
    await expect(page.getByText('上次读数 · 已失效')).toBeVisible()
    await expect(page.getByRole('button', { name: '开始采集' })).toBeDisabled()
  })
}
