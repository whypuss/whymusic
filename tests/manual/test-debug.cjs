const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const networkErrors = [];
  page.on('requestfailed', req => {
    networkErrors.push(req.url());
    console.log('[NETWORK FAIL]', req.url());
  });

  await page.goto('http://localhost:8894', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // 檢查 localStorage
  const savedPlugins = await page.evaluate(() => {
    const data = localStorage.getItem('musicfree-plugins');
    return data ? JSON.parse(data) : null;
  });
  console.log('[LOCALSTORAGE plugins]:', savedPlugins);

  const savedCodes = await page.evaluate(() => {
    const data = localStorage.getItem('musicfree-plugin-codes');
    return data ? JSON.parse(data) : null;
  });
  console.log('[LOCALSTORAGE codes]:', savedCodes);

  // 檢查 DOM 狀態
  const allDivs = await page.locator('.space-y-2 > div').count();
  console.log(`[DOM] 初始結果數量: ${allDivs}`);

  // 模擬人工操作：輸入關鍵字並點擊
  await page.fill('input[type="text"]', 'hello');
  await page.click('button:has-text("搜索")');
  console.log('[TEST] 已點擊搜索按鈕');

  await page.waitForTimeout(10000);

  // 檢查搜索後的 DOM
  const results = await page.locator('.space-y-2 > div').count();
  console.log(`[DOM] 搜索後結果數量: ${results}`);

  if (results > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('[RESULTS]', items.slice(0, 3));
  } else {
    const centerText = await page.locator('.text-center').textContent();
    console.log('[CENTER MSG]:', centerText);
  }

  console.log(`\n[ERRORS] ${errors.length} errors`);
  errors.forEach(e => console.log(' -', e));

  console.log(`\n[NETWORK ERRORS] ${networkErrors.length} failures`);
  networkErrors.forEach(e => console.log(' -', e));

  // 檢查 localStorage 中是否有 Audiomack 插件
  const hasAudiomack = await page.evaluate(() => {
    const data = localStorage.getItem('musicfree-plugins');
    if (data) {
      const plugins = JSON.parse(data);
      return plugins.filter(p => p.name === 'Audiomack');
    }
    return [];
  });
  console.log('[AUDIOMACK SAVED]:', hasAudiomack);

  await page.waitForTimeout(10000);
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
