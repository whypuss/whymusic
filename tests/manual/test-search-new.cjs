const { chromium } = require('playwright');
const http = require('http');

async function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let path = '/Users/whypuss/projects/musicweb/packages/web/dist' + (url.pathname === '/' ? '/index.html' : url.pathname);
      const fs = require('fs');
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
      const ext = path.split('.').pop();
      fs.readFile(path, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime['.' + ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(18894, () => resolve(server));
  });
}

async function test() {
  const server = await startLocalServer();
  const browser = await chromium.launch({ headless: true });
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

  console.log('[TEST] 打開本地服務 (最新版本)...');
  await page.goto('http://localhost:18894', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  console.log('[TEST] 輸入 "hello" 並搜索...');
  await page.fill('input[type="text"]', 'hello');
  await page.press('input[type="text"]', 'Enter');
  await page.waitForTimeout(8000);

  const resultCount = await page.locator('.space-y-2 > div').count();
  console.log(`[TEST] 結果數量: ${resultCount}`);

  if (resultCount > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('[TEST] 前5個結果:', items.slice(0, 5));
    console.log('[TEST] ✅ 搜索成功！');
  } else {
    const err = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[TEST] ❌ 錯誤提示:', err);
  }

  console.log(`\n=== 錯誤 (${errors.length}個) ===`);
  errors.forEach(e => console.log(' -', e));

  server.close();
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
