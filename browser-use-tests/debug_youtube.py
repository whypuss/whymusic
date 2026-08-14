#!/usr/bin/env python3
"""Test YouTube plugin search after CORS fix."""
import asyncio
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            locale='zh-CN'
        )
        page = await context.new_page()
        
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text[:500]}'))
        page.on('pageerror', lambda err: logs.append(f'[PAGE_ERROR] {err}'))
        
        # 1. Load
        print("1. Loading...")
        await page.goto('http://localhost:8894', wait_until='networkidle')
        await asyncio.sleep(3)
        
        # 2. Clear localStorage and reload to get fresh install
        print("2. Clean install...")
        ls_state = await page.evaluate("""() => {
            // Save current plugin codes, reinstall YouTube
            return JSON.parse(localStorage.getItem('musicfree-plugins') || '[]').map(p => ({
                name: p.name, 
                enabled: p.enabled,
                code_len: (p.code || '').length
            }));
        }""")
        print("   ", json.dumps(ls_state))
        
        # 3. Install YouTube from store
        print("3. Clicking Store tab...")
        await page.click('button:has-text("商店")')
        await asyncio.sleep(1)
        
        # Check if YouTube is already installed
        youtube_state = await page.evaluate("""() => {
            const plugins = JSON.parse(localStorage.getItem('musicfree-plugins') || '[]');
            const has = plugins.some(p => p.name === 'YouTube');
            return {already_installed: has, plugins: plugins.map(p => p.name)};
        }""")
        
        if not youtube_state['already_installed']:
            print("4. Installing YouTube...")
            result = await page.evaluate("""async () => {
                const items = document.querySelectorAll('.max-w-2xl.mx-auto > div > div');
                for (const item of items) {
                    const nameEl = item.querySelector('.font-medium');
                    if (nameEl && nameEl.textContent === 'YouTube') {
                        const installBtn = item.querySelector('button');
                        if (installBtn && installBtn.textContent.trim() === '安裝') {
                            installBtn.click();
                            await new Promise(r => setTimeout(r, 3000));
                            return {status: 'installed'};
                        }
                    }
                }
                return {status: 'button_not_found'};
            }""")
            print("   ", result)
        else:
            print("4. YouTube already installed, skipping")
        
        # 5. Search
        print("5. Going to Search tab...")
        await page.click('button:has-text("搜索")')
        await asyncio.sleep(1)
        
        print("6. Searching...")
        search_input = await page.query_selector('input[type="text"]')
        await search_input.fill('shape of you')
        await asyncio.sleep(0.5)
        
        # Click search button
        search_btn = await page.query_selector('button:has-text("搜索"):not(:disabled)')
        await search_btn.click()
        
        await asyncio.sleep(8)  # Wait for results
        await page.screenshot(path='/tmp/search_result.png')
        
        results_text = await page.evaluate("() => document.querySelector('.space-y-2')?.innerText || 'no results div'")
        print("\nSearch results:", results_text[:800])
        
        # 7. Print relevant logs
        print("\n=== Relevant logs ===")
        for log in logs:
            if any(x in log.lower() for x in ['youtube', 'cors', 'plugin', 'axios', 'search', 'backend']):
                print(" ", log)
            if 'error' in log.lower() and 'vite' not in log.lower():
                print(" ", log)
        
        # Count results
        items = await page.evaluate("() => document.querySelectorAll('.space-y-2 > div').length")
        print(f"\nResult items found: {items}")
        
        await browser.close()
        print("\nDone!")

if __name__ == '__main__':
    asyncio.run(main())