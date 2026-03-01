const { chromium } = require('playwright');

async function connect() {
  const browser = await chromium.launch();
  return {
    page: async (name, options) => {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      return page;
    },
    disconnect: async () => {
      await browser.close();
    }
  };
}

async function waitForPageLoad(page) {
  await page.waitForLoadState('networkidle');
}

module.exports = { connect, waitForPageLoad };
