import { expect, type Page } from '@playwright/test'

export async function openConnection(page: Page) {
  await page.getByRole('button', { name: '连接设备', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接与设备' })).toBeVisible()
}

export async function connectDevice(page: Page, kind: 'usb' | 'ble' = 'ble') {
  await openConnection(page)
  await page
    .getByRole('group', { name: '连接方式', exact: true })
    .getByRole('button', { name: kind === 'usb' ? 'USB' : 'BLE 蓝牙', exact: true })
    .click()
  await page.getByRole('button', { name: '搜索设备', exact: true }).click()
  await expect(page.getByLabel('后端设备')).toHaveValue('test-device')
  await page.getByRole('button', { name: '连接所选设备' }).click()
  await expect(page.locator('.connection-status')).toHaveText('已连接')
}

export async function openResources(page: Page) {
  await page
    .getByRole('button', { name: '板卡与引脚', exact: true })
    .filter({ visible: true })
    .first()
    .click()
  return page.getByRole('dialog', { name: '引脚与资源', exact: true })
}

export async function openWiring(page: Page) {
  const resources = await openResources(page)
  await resources.getByRole('button', { name: '实物接线图 · 32 引脚' }).click()
  return page.getByRole('dialog', { name: '实物接线图 · 32 引脚', exact: true })
}
