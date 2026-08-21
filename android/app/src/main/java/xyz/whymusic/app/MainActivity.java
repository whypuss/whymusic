package xyz.whymusic.app;

import android.os.Bundle;
import android.webkit.WebSettings;
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
    }
}
