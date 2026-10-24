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
export async function selectPin(page: Page, id: string) {
  const back = page.getByRole('button', { name: '← 返回板卡', exact: true })
  if (await back.isVisible()) await back.click()
  await page.locator(`.board-stage [data-pin-id="${id}"]:visible`).click()
}
export async function selectLed(page: Page) {
  const back = page.getByRole('button', { name: '← 返回板卡', exact: true })
  if (await back.isVisible()) await back.click()
  await page.getByRole('button', { name: '板上 D5 实验灯 / GPIO13', exact: true }).first().click()
}
export async function openResource(page: Page, name: string) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '设备工作台', exact: true })
    .click()
  if (name === '片内温度') {
    await page.getByRole('button', { name: '片内功能', exact: true }).click()
    await page.getByRole('button', { name, exact: true }).click()
    return
  }
  if (name.endsWith('子设备')) {
    await openResource(page, name.startsWith('I²C') ? 'I²C 主总线' : 'SPI 主总线')
    await page.getByRole('button', { name: '添加' + name, exact: true }).click()
    return
  }
  await selectPin(page, 'R12')
  const family = name.startsWith('I²C')
    ? 'I²C'
    : name.startsWith('SPI')
      ? 'SPI'
      : name.startsWith('RMT')
        ? 'RMT'
        : name.includes('ADC')
          ? 'ADC'
          : null
  const toggle = family
    ? page.locator('.pin-functions button[aria-expanded]').filter({ hasText: family })
    : null
  if (toggle && (await toggle.count())) {
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
    await page.locator('.function-subtypes').getByRole('button', { name, exact: true }).click()
  } else {
    await page
      .locator('.pin-functions')
      .getByRole('button', {
        name: new RegExp('^' + (family ?? name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
      .click()
  }
  const choice = page.getByRole('heading', { name: /此引脚在/ })
  if (await choice.isVisible()) await choice.locator('..').getByRole('button').first().click()
}
export async function saveAndCheck(page: Page) {
  await page.getByRole('button', { name: '保存方案', exact: true }).click()
  await expect(page.getByRole('button', { name: '检查本组', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '检查本组', exact: true }).click()
  await expect(page.getByRole('button', { name: '应用本组', exact: true })).toBeEnabled()
}
