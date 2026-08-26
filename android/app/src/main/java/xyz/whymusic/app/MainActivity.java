package xyz.whymusic.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * 除了 Capacitor 的預設行為，只多做一件事：關掉 WebView 的 HTTP 快取。
 *
 * 為什麼需要：前端整包是打包在 APK 裡的本地資產，快取它沒有任何好處（檔案就在
 * 裝置上），但會製造一個很難查的故障 —— 更新 APK 之後 WebView 仍從快取讀
 * index.html，於是畫面還是舊版前端。JS/CSS 的檔名帶內容雜湊所以不受影響，但
 * index.html 檔名固定，一旦被快取住，它引用的就永遠是舊那組雜湊檔名，換版等於沒換。
 *
 * 實際踩過：APK 已經是新版，「設置」頁的建置戳記卻還顯示上一版 —— 靠那個戳記
 * 才發現。index.html 也加了 no-store 的 meta，這裡是第二道保險（meta 要等到
 * 下一次載入才生效，這個設定連第一次都管到）。
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自訂插件要在 super.onCreate 之前註冊，Capacitor 才會把它掛進 bridge
        registerPlugin(BackgroundPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings()
                .setCacheMode(WebSettings.LOAD_NO_CACHE);
            reportSystemBarInsets(getBridge().getWebView());
        }

        // 返回鍵／側滑：先問前端要不要自己吃掉這一下（歌詞頁開著時就是「縮小回
        // 主頁」），前端說沒處理才交回系統退出 app。
        //
        // Capacitor 8 自己完全不處理返回（那是 @capacitor/app 插件的事，本專案沒裝
        // 它），預設行為就是直接關 Activity —— 歌詞頁一按返回整個 app 就沒了。
        //
        // 為什麼問前端而不是看 WebView 歷史：實測 `canGoBack()` 對 history.pushState
        // 加的那筆回 **false**（同文件導覽不進 WebView 的 back-forward list），所以
        // 「有歷史就 goBack」那招在這裡永遠走不到，歌詞頁照樣退出 app。
        //
        // 用 OnBackPressedDispatcher 而不是覆寫 onBackPressed：targetSdk 36 起預測式
        // 返回預設啟用，舊的 onBackPressed 在手勢導航下不會被呼叫。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) {
                    exitApp();
                    return;
                }
                // 前端沒回話（JS 卡住／還沒載好）就照系統預設退出 —— 少了這個逾時，
                // WebView 一出事使用者就按不出 app 了。
                //
                // 1.5 秒是逾時而不是預算：真機上這趟往返是幾毫秒，逾時只在 WebView
                // 真的死了才會走到。給太短會反過來咬人 —— 400ms 在慢速模擬器上
                // 就先於 JS 的回覆觸發，結果歌詞頁關了、app 也一起退了。
                final boolean[] settled = { false };
                final android.os.Handler handler = new android.os.Handler(getMainLooper());
                final Runnable fallback = () -> {
                    if (settled[0]) return;
                    settled[0] = true;
                    exitApp();
                };
                handler.postDelayed(fallback, 1500);
                wv.evaluateJavascript(
                    "(function(){try{return !!(window.__whymusicHandleBack && window.__whymusicHandleBack())}catch(e){return false}})()",
                    value -> {
                        if (settled[0]) return;
                        settled[0] = true;
                        handler.removeCallbacks(fallback);
                        if (!"true".equals(value)) exitApp();
                    });
            }

            /** 把這一下交回系統：暫時停用自己，讓預設行為（關 Activity）跑完 */
            private void exitApp() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    /**
     * 把系統列（導航列／狀態列）實際佔掉的高度餵給前端，存成 CSS 變數
     * --wm-inset-top / --wm-inset-bottom。
     *
     * 為什麼不能只靠 CSS 的 env(safe-area-inset-*)：Android 的 WebView 只把
     * **顯示屏缺口**（劉海、打孔）算進 safe-area，導航列不算 —— 於是三鍵導航的
     * 手機上 env(safe-area-inset-bottom) 是 0，而 targetSdk 35 起版面又是強制
     * 延伸到系統列底下的，結果就是虛擬按鍵直接蓋住我們最底下那排分頁按鈕。
     * iPhone 的手勢條靠 env() 就對了，所以前端兩者取大值，兩邊都不必特判。
     *
     * 用 setOnApplyWindowInsetsListener 而不是開頭量一次：導航列會變（轉螢幕、
     * 手勢／三鍵切換、鍵盤彈出），每次系統送 insets 過來就更新一次才跟得上。
     */
    private void reportSystemBarInsets(WebView webView) {
        // 掛在 Activity 的內容視圖，不是 WebView —— insets 派發到 WebView 之前就被
        // 上層吃掉了，掛在它身上那個 listener 一次都不會觸發（實測：完全沒有日誌）。
        // 回傳原本的 insets，不消耗，免得影響其他視圖。
        android.view.View root = findViewById(android.R.id.content);
        if (root == null) return;
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            pushInsets(webView, insets);
            return insets;
        });
        // 再直接讀一次現值：掛上 listener 之前系統早就派發過了，只等下一次派發的話
        // 開 app 的第一眼還是被蓋住的。
        root.post(() -> pushInsets(webView, androidx.core.view.ViewCompat.getRootWindowInsets(root)));
    }

    /** onResume 也讀一次：使用者可能在背景時切了導航方式（手勢 ↔ 三鍵） */
    @Override
    public void onResume() {
        super.onResume();
        android.view.View root = findViewById(android.R.id.content);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (root != null && webView != null) {
            root.post(() -> pushInsets(webView, androidx.core.view.ViewCompat.getRootWindowInsets(root)));
        }
    }

    /** 取系統列高度（px → CSS px）並寫進前端 */
    private void pushInsets(WebView webView, androidx.core.view.WindowInsetsCompat insets) {
        if (insets == null) return;
        androidx.core.graphics.Insets bars = insets.getInsets(
            androidx.core.view.WindowInsetsCompat.Type.systemBars());
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        applyInsetsToWeb(webView,
            Math.round(bars.top / density), Math.round(bars.bottom / density));
    }

    /**
     * 寫進 CSS 變數。系統第一次送 insets 過來時頁面多半還沒載好（那時注入會直接
     * 落空、之後又不一定再送一次），所以同一組值補送幾次 —— 每次就是設兩個字串
     * 變數，重複做不痛不癢，比漏掉一次讓按鈕被蓋住划算。
     */
    private void applyInsetsToWeb(WebView webView, int top, int bottom) {
        final String js = "(function(){var s=document.documentElement.style;"
            + "s.setProperty('--wm-inset-top','" + top + "px');"
            + "s.setProperty('--wm-inset-bottom','" + bottom + "px');})()";
        android.os.Handler handler = new android.os.Handler(getMainLooper());
        for (int delay : new int[] { 0, 500, 1500, 3000 }) {
            handler.postDelayed(() -> webView.evaluateJavascript(js, null), delay);
        }
    }
}
