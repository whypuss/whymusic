package xyz.whymusic.app;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS 與 PlaybackService 之間的橋。介面刻意小：
 *
 *   update({title, artist, playing, positionSec, durationSec})
 *     每次換歌／播放／暫停／跳轉時呼叫。播放中而服務未啟動時會順便啟動它。
 *   stop()
 *     結束播放工作階段（服務、通知、wakelock 一起收掉）。
 *
 * 反向：鎖屏／通知欄的按鍵透過 "control" 事件送回 JS
 * （{action: "play"|"pause"|"next"|"previous"|"seek", seekTime?}）。
 */
@CapacitorPlugin(name = "BackgroundPlayback")
public class BackgroundPlaybackPlugin extends Plugin {
    private static volatile BackgroundPlaybackPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void dispatchControl(String action, Long seekMs) {
        BackgroundPlaybackPlugin p = instance;
        Log.d("WhyPlayback", "dispatchControl " + action + " plugin=" + (p != null));
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        if (seekMs != null) data.put("seekTime", seekMs / 1000.0);
        p.notifyListeners("control", data);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        long positionMs = Math.round(call.getDouble("positionSec", 0.0) * 1000);
        long durationMs = Math.round(call.getDouble("durationSec", 0.0) * 1000);

        PlaybackService svc = PlaybackService.instance;
        if (svc != null) {
            svc.update(title, artist, playing, positionMs, durationMs);
        } else if (playing) {
            // 服務還沒起來：帶著完整狀態啟動它（第一次播放時 App 必在前台，
            // 前台服務的啟動限制不會擋）
            Intent i = new Intent(getContext(), PlaybackService.class);
            i.putExtra("title", title);
            i.putExtra("artist", artist);
            i.putExtra("playing", true);
            i.putExtra("positionMs", positionMs);
            i.putExtra("durationMs", durationMs);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
        }
        // 暫停狀態且服務不在 → 沒事可做
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }
}
