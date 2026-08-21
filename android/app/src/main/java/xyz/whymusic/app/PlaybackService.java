package xyz.whymusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

/**
 * 播放期間的前台服務 + 原生 MediaSession。解決兩件事：
 *
 * 1. **關屏後不續播下一首。** 音樂在 WebView 的 audio 元素裡播放時，音訊管線
 *    本身會讓系統保持醒著；但一首播完的那一刻音訊停了，沒有任何東西阻止 CPU
 *    立刻休眠 —— 「取下一首、呼叫 play()」的 JS 根本沒機會執行。使用者看到的
 *    症狀：關屏後播完一首就安靜，開屏那一秒下一首才突然開始。
 *    前台服務（mediaPlayback 類型）+ partial wakelock + WifiLock 撐過交界。
 *
 * 2. **國產 ROM 不把這個 App 當音樂播放器。** vivo／一加等判定「音樂 App」看的
 *    是原生 MediaSession —— WebView 內部的 navigator.mediaSession 它們看不見
 *    （實測 vivo 連通知欄的媒體通知都沒有）。這裡建真的 MediaSession + MediaStyle
 *    通知，鎖屏控制、通知欄播放鍵、vivo 原子隨身聽才全部生效，系統也因此不會
 *    隨手殺掉它。
 *
 * 控制流向：鎖屏／通知的按鍵 → MediaSession callback → 靜態轉發給
 * BackgroundPlaybackPlugin → JS 事件 → 播放器動作。曲目資訊反向由 JS 每次
 * 換歌／播放暫停時推過來。播放進度不逐秒同步 —— PlaybackState 設了播放速率，
 * 系統自己會外推。
 */
public class PlaybackService extends Service {
    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    static final String ACTION_TOGGLE = "xyz.whymusic.app.TOGGLE";
    static final String ACTION_NEXT = "xyz.whymusic.app.NEXT";
    static final String ACTION_PREV = "xyz.whymusic.app.PREV";

    /** 單進程 App，插件與服務之間用靜態引用最直接 */
    static volatile PlaybackService instance;

    private MediaSession session;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private String title = "WhyMusic";
    private String artist = "";
    private boolean playing = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        session = new MediaSession(this, "whymusic");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public boolean onMediaButtonEvent(Intent i) {
                Log.d("WhyPlayback", "onMediaButtonEvent: " + i);
                return super.onMediaButtonEvent(i);
            }
            @Override public void onPlay() { BackgroundPlaybackPlugin.dispatchControl("play", null); }
            @Override public void onPause() { BackgroundPlaybackPlugin.dispatchControl("pause", null); }
            @Override public void onSkipToNext() { BackgroundPlaybackPlugin.dispatchControl("next", null); }
            @Override public void onSkipToPrevious() { BackgroundPlaybackPlugin.dispatchControl("previous", null); }
            @Override public void onSeekTo(long pos) { BackgroundPlaybackPlugin.dispatchControl("seek", pos); }
        });
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(
            PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE.equals(action)) {
            BackgroundPlaybackPlugin.dispatchControl(playing ? "pause" : "play", null);
            return START_NOT_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            BackgroundPlaybackPlugin.dispatchControl("next", null);
            return START_NOT_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            BackgroundPlaybackPlugin.dispatchControl("previous", null);
            return START_NOT_STICKY;
        }

        if (intent != null && intent.hasExtra("title")) {
            update(
                intent.getStringExtra("title"),
                intent.getStringExtra("artist"),
                intent.getBooleanExtra("playing", false),
                intent.getLongExtra("positionMs", 0),
                intent.getLongExtra("durationMs", 0)
            );
        } else {
            promoteToForeground();
        }
        // 被系統回收就算了，不自行復活 —— 由 JS 在下一次播放時重新啟動
        return START_NOT_STICKY;
    }

    /** JS 推狀態過來：換歌、播放、暫停都走這裡 */
    void update(String title, String artist, boolean playing, long positionMs, long durationMs) {
        this.title = title == null || title.isEmpty() ? "WhyMusic" : title;
        this.artist = artist == null ? "" : artist;
        this.playing = playing;

        MediaMetadata.Builder md = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, this.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, this.artist);
        if (durationMs > 0) md.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        session.setMetadata(md.build());

        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                positionMs, playing ? 1.0f : 0f)
            .build());

        promoteToForeground();

        // wakelock 只在播放中持有。暫停時放掉 —— 服務與通知留著（隨時能從鎖屏恢復），
        // 但不再阻止 CPU 休眠，不白耗電。
        if (playing) acquireLocks();
        else releaseLocks();
    }

    private void promoteToForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "whymusic:playback");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire();
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            // 音源在網路上，交界處要抓下一首的資料 —— Wi-Fi 也不能睡
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "whymusic:playback");
            wifiLock.setReferenceCounted(false);
        }
        if (!wifiLock.isHeld()) wifiLock.acquire();
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i, PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "播放", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("播放控制與背景續播");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(session.getController().getSessionActivity())
            .setOngoing(playing)
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "上一首",
                serviceAction(ACTION_PREV, 1)).build())
            .addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暫停" : "播放",
                serviceAction(ACTION_TOGGLE, 2)).build())
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_next, "下一首",
                serviceAction(ACTION_NEXT, 3)).build())
            .setStyle(new Notification.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        return b.build();
    }

    /** 使用者把 App 從最近工作滑掉：WebView 已死，留一個殭屍通知沒有意義 */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
