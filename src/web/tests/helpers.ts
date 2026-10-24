import { expect, type Page } from '@playwright/test'
export async function reset(page: Page) {
  await page.request.post('/api/testing/reset')
  await page.goto('/')
  await expect(page.getByRole('button', { name: '连接设备', exact: true }).first()).toBeVisible()
}
export async function connect(page: Page, profile = 'signal') {
  await page.getByRole('button', { name: '连接设备', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: '连接设备', exact: true })
  await dialog.getByLabel('连接方式').selectOption('usb')
  await dialog.getByRole('button', { name: '搜索服务主机设备' }).click()
  await dialog.getByLabel('选择目标设备').selectOption(profile === 'bus' ? 'test' : profile)
  await dialog.getByRole('button', { name: '连接并识别固件' }).click()
  await expect(dialog.getByText('已连接', { exact: false }).first()).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.identity-tag')).toContainText(profile)
  await expect(page.locator('.connection-status')).toHaveText('已连接')
}
export async function acquire(page: Page) {
  await page.getByRole('button', { name: '取得设备控制', exact: true }).first().click()
  await expect(page.locator('.control-status')).toHaveText('已取得控制')
}
export async function openResource(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name: '外设调试', exact: true }).click()
  await page
    .getByLabel('外设功能', { exact: true })
    .getByRole('button', { name, exact: true })
    .click()
}
