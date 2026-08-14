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
  console.log('[TEST] 頁面加載完成');

  // 等插件加載（人工操作中用戶也可能這麼做）
  await page.waitForTimeout(5000);
  console.log('[TEST] 等待插件加載完成...');

  // 輸入
  await page.fill('input[type="text"]', 'hello');
  console.log('[TEST] 已輸入 "hello"');

  // 人工點擊按鈕
  await page.click('button:has-text("搜索")');
  console.log('[TEST] 已點擊搜索按鈕');

  await page.waitForTimeout(8000);

  // 檢查 DOM 中的結果（不是 console.log）
  const resultDivs = await page.$$('.space-y-2 > div');
  console.log(`[TEST] DOM 中結果數量: ${resultDivs.length}`);

  for (let i = 0; i < Math.min(resultDivs.length, 5); i++) {
    const text = await resultDivs[i].textContent();
    console.log(`[RESULT ${i+1}]:`, text);
  }

  if (resultDivs.length === 0) {
    const centerText = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[ERROR MSG]:', centerText);
  }

  // 檢查是否有 loading 狀態
  const loadingBtn = await page.$('button:has-text("搜索中")');
  if (loadingBtn) {
    console.log('[LOADING] 搜索仍在進行...');
  }

  console.log(`\n=== 錯誤數量: ${errors.length} ===`);
  errors.forEach(e => console.log(' -', e));

  await page.waitForTimeout(10000);
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
