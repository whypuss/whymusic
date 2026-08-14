const { chromium } = require('playwright');

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://musicweb-4g0.pages.dev', { waitUntil: 'networkidle' });

  const corsErrors = [];
  page.on('requestfailed', async (req) => {
    console.log('[REQ FAIL]', req.url(), '->', req.failure()?.errorText || 'unknown');
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('audiomack') || url.includes('search')) {
      console.log('[RESPONSE]', url, res.status());
    }
  });

  await page.waitForTimeout(5000);
  await page.fill('input[type="text"]', 'hello');
  await page.press('input[type="text"]', 'Enter');
  await page.waitForTimeout(8000);

  const resultCount = await page.locator('.space-y-2 > div').count();
  console.log('[RESULTS]', resultCount);
  if (resultCount > 0) {
    const items = await page.locator('.space-y-2 > div').allTextContents();
    console.log('[ITEMS]', items.slice(0, 3));
  } else {
    const err = await page.locator('.text-center.text-gray-500').textContent();
    console.log('[ERR]', err);
  }

  // 直接測試 API 請求
  console.log('\n=== 直接請求 Audiomack API ===');
  try {
    const apiRes = await page.evaluate(async () => {
      const res = await fetch('https://api.audiomack.com/v1/search?q=hello&page=1&limit=20&oauth_consumer_key=audiomack-js&oauth_nonce=test&oauth_signature_method=HMAC-SHA1&oauth_timestamp=' + Math.floor(Date.now()/1000) + '&oauth_version=1.0&show=songs&sort=popular');
      return { status: res.status, headers: Object.fromEntries(res.headers) };
    });
    console.log('API status:', apiRes.status);
    console.log('CORS headers:', apiRes.headers);
  } catch (e) {
    console.log('API error:', e.message);
  }

  await browser.close();
}

test().catch(e => { console.error(e); process.exit(1); });
