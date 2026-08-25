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
}
