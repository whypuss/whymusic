const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  page.on('console', msg => console.log(`[${msg.type()}]`, msg.text()));
  page.on('requestfailed', req => console.log('[FAIL]', req.url()));

  // 打開本地開發服務
  await page.goto('http://localhost:8894', { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000); // 插件加載時間

  // 檢查初始狀態
  const initialDivs = await page.$$('.space-y-2 > div');
  console.log('[INIT] DOM divs:', initialDivs.length);
  if (initialDivs.length > 0) {
    const text = await initialDivs[0].textContent();
    console.log('[INIT] First div:', text);
  }

  // 輸入關鍵字
  await page.fill('input[type="text"]', 'hello');
  await page.waitForTimeout(500);

  // 檢查 input 值
  const val = await page.inputValue('input[type="text"]');
  console.log('[INPUT] Value:', val);

  // 點擊搜索按鈕
  await page.click('button:has-text("搜索")');
  console.log('[CLICK] Button clicked');

  // 等待更長時間
  await page.waitForTimeout(10000);

  // 檢查最終狀態
  const finalDivs = await page.$$('.space-y-2 > div');
  console.log('[FINAL] DOM divs:', finalDivs.length);
  for (let i = 0; i < Math.min(finalDivs.length, 5); i++) {
    const text = await finalDivs[i].textContent();
    console.log(`[RESULT ${i+1}]`, text);
  }

  // 檢查 loading 狀態
  const loading = await page.$('button:has-text("搜索中")');
  console.log('[LOADING]', !!loading);

  // 檢查錯誤消息
  const errors = await page.$$('[class*="text-center"]');
  for (const e of errors) {
    const text = await e.textContent();
    console.log('[ERROR MSG]', text);
  }

  await page.waitForTimeout(10000);
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
