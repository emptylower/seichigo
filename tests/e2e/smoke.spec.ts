import { test, expect } from '@playwright/test';

/**
 * Smoke test for /map page
 * 
 * Note: MapLibre requires WebGL which may fail in headless browsers.
 * This test verifies the page loads and renders UI elements,
 * but does not require the map canvas to fully initialize.
 */
test('map page loads successfully', async ({ page }) => {
  // Navigate to map page
  await page.goto('/map');
  
  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');
  
  // Verify the page heading is present
  const heading = await page.locator('h1, h2').filter({ hasText: '巡礼地图' }).first();
  await expect(heading).toBeVisible({ timeout: 10000 });
  
  // Verify sidebar content is present (loading state is acceptable in headless)
  const sidebar = await page.locator('aside, [role="complementary"], div').filter({ hasText: '正在加载' }).first();
  await expect(sidebar).toBeVisible();
});
