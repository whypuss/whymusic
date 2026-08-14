const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

async function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      let path = '/Users/whypuss/projects/musicweb/packages/web/dist' + (url.pathname === '/' ? '/index.html' : url.pathname);
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
      const ext = path.split('.').pop();
      fs.readFile(path, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': mime['.' + ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(18894, () => resolve(server));
  });
}

async function test() {
  const server = await startLocalServer();
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage();

  // 收集所有輸出
  const logs = [];
  page.on('console', msg => {
    logs.push({ type: msg.type(), text: msg.text() });
    console.log(`[${msg.type()}]`, msg.text());
  });

  const errors = [];
  page.on('requestfailed', req => {
    console.log('[NETWORK FAIL]', req.url(), req.failure()?.errorText);
    errors.push(req.url());
  });

  console.log('[TEST] 打開本地最新版本 (http://localhost:18894)...');
  await page.goto('http://localhost:18894', { waitUntil: 'networkidle' });
  
  console.log('[TEST] 等待 3 秒讓插件加載...');
  await page.waitForTimeout(3000);

  console.log('[TEST] 檢查插件狀態...');
  const pluginInfo = await page.evaluate(() => {
    const ps = window._pluginManager ? window._pluginManager.getPlugins() : [];
    return ps.map(p => ({ name: p.name, enabled: window._pluginManager?.isPluginEnabled(p.name) }));
  });
  console.log('[TEST] 已安裝插件:', JSON.stringify(pluginInfo, null, 2));

  console.log('[TEST] 輸入 "hello" 並搜索...');
  await page.fill('input[type="text"]', 'hello');
  await page.press('input[type="text"]', 'Enter');
  
  console.log('[TEST] 等待 8 秒...');
  await page.waitForTimeout(8000);

  const resultCount = await page.locator('.space-y-2 > div').count();
  console.log(`\n[RESULT] 搜索結果數量: ${resultCount}`);

  if (resultCount > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('\n[SEARCH RESULTS]:');
    items.slice(0, 10).forEach((t, i) => console.log(`  ${i+1}. ${t}`));
    console.log('\n✅ 搜索成功！');
  } else {
    const err = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[ERROR]', err);
  }

  console.log(`\n[NETWORK ERRORS] ${errors.length} failures`);
  if (errors.length > 0) errors.forEach(e => console.log('  -', e));

  // 保持打開讓用戶看
  console.log('\n[INFO] 頁面保持打開 30 秒，你可以看到搜索結果');
  await page.waitForTimeout(30000);

  server.close();
  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
