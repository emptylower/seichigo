import { test, expect } from '@playwright/test';

test('home page loads successfully', async ({ page }) => {
  await page.goto('/');
  
  await page.waitForLoadState('networkidle');
  
  const title = await page.title();
  expect(title).toContain('SeichiGo');
});
