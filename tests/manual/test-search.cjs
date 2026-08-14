const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-web-security', '--disable-features=VizDisplayCompositor'],
  });

  const page = await browser.newPage();
  console.log('[TEST] 打開 musicweb-4g0.pages.dev...');
  await page.goto('https://musicweb-4g0.pages.dev', { waitUntil: 'networkidle' });
  console.log('[TEST] 頁面加載完成');

  // 收集控制台消息
  const logs = [];
  page.on('console', msg => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.text().includes('[Search]') || msg.text().includes('[Auto-init]') || msg.text().includes('[Plugins]') || msg.type() === 'error') {
      console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    }
  });

  // 收集網路錯誤
  const errors = [];
  page.on('requestfailed', req => {
    errors.push(req.url());
    console.log('[NETWORK FAIL]', req.url());
  });

  // 等待插件加載
  await page.waitForTimeout(5000);
  console.log('[TEST] 插件加載等待完成');

  // 輸入搜索並提交
  await page.fill('input[type="text"]', 'hello');
  await page.press('input[type="text"]', 'Enter');
  await page.waitForTimeout(8000);

  // 檢查結果
  const resultCount = await page.locator('.space-y-2 > div').count();
  console.log(`[TEST] 結果數量: ${resultCount}`);

  if (resultCount > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('[TEST] 前3個結果:', items.slice(0, 3));
  } else {
    const errorText = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[TEST] 錯誤提示:', errorText);
  }

  console.log('\n=== 完整控制台日志 ===');
  logs.forEach(l => console.log(l));

  console.log(`\n=== 網路錯誤 (${errors.length}個) ===`);
  errors.forEach(e => console.log(' -', e));

  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
