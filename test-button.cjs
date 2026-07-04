const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.log('[CONSOLE ERROR]', msg.text());
    }
    if (msg.text().includes('[Search]') || msg.text().includes('[Plugins]') || msg.text().includes('[Auto-init]')) {
      console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    }
  });

  await page.goto('http://localhost:8894', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  // 檢查當前狀態
  console.log('[TEST] 頁面已加載');
  const keywordVal = await page.inputValue('input[type="text"]');
  console.log('[TEST] 當前關鍵字:', keywordVal);

  // 輸入關鍵字
  await page.fill('input[type="text"]', 'hello');
  console.log('[TEST] 已輸入 "hello"');

  // 檢查按鈕是否被 disabled
  const buttonDisabled = await page.$eval('button:has-text("搜索")', el => el.disabled);
  console.log('[TEST] 搜索按鈕 disabled:', buttonDisabled);

  // 人工點擊搜索按鈕
  console.log('[TEST] 點擊搜索按鈕...');
  await page.click('button:has-text("搜索")');
  await page.waitForTimeout(8000);

  const resultCount = await page.locator('.space-y-2 > div').count();
  console.log(`[TEST] 結果數量: ${resultCount}`);

  if (resultCount > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('[TEST] 前3個結果:', items.slice(0, 3));
    console.log('✅ 搜索成功！');
  } else {
    const err = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[TEST] 錯誤提示:', err);
  }

  console.log('\n=== 錯誤 ===');
  errors.forEach(e => console.log(' -', e));

  await page.waitForTimeout(10000);
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
