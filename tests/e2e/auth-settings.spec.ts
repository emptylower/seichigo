import { expect, test } from '@playwright/test'

const adminEmail = 'lijianjie@koi.codes'
const password = 'E2Epass123!'

test('admin can sign in and load settings from the database', async ({ page }) => {
  await page.goto('/auth/signin?callbackUrl=%2Fme%2Fsettings')

  await page.getByRole('button', { name: '账号密码' }).click()
  await page.locator('#password-email').fill(adminEmail)
  await page.locator('#password-password').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()

  await expect(page).toHaveURL(/\/me\/settings/)
  await expect(page.getByRole('heading', { name: '个人信息' })).toBeVisible()
  await expect(page.getByLabel('昵称')).toHaveValue('E2E Admin')
})
