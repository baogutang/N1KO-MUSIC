package cn.baogutang.musicstreampro;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import com.getcapacitor.JSObject;

/**
 * WebView 的 audio 标签不认 FLAC，平板系统的解码器认。
 * 赵雷这批 192kHz FLAC 走这里，直接解成 PCM 送给声卡，不先包成 WAV。
 */
@UnstableApi
final class WebDavFlacPlayer {
    private static final String TAG = "WebDavFlac";
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    interface Sink {
        void emit(String event, JSObject data);
    }

    private static ExoPlayer player;
    private static Sink sink = (event, data) -> { };
    private static volatile int generation;
    private static boolean wantPlay;
    private static float volume = 1f;
    private static float rate = 1f;
    private static long pendingSeekMs = -1;
    private static int readyGeneration = -1;
    private static final Runnable TICK = new Runnable() {
        @Override
        public void run() {
            ExoPlayer current = player;
            if (current == null) return;
            emitTime(current);
            int state = current.getPlaybackState();
            if (state != Player.STATE_IDLE && state != Player.STATE_ENDED) {
                MAIN.postDelayed(this, 200);
            }
        }
    };

    private WebDavFlacPlayer() {}

    static void setSink(Sink next) {
        sink = next == null ? (event, data) -> { } : next;
    }

    static int open(Context context, String url, float nextVolume, float nextRate) {
        final int token = ++generation;
        MAIN.post(() -> {
            if (token != generation) return;
            volume = nextVolume;
            rate = nextRate;
            wantPlay = false;
            pendingSeekMs = -1;
            readyGeneration = -1;
            MAIN.removeCallbacks(TICK);
            try {
                ExoPlayer exo = ensurePlayer(context.getApplicationContext());
                exo.setVolume(volume);
                exo.setPlaybackParameters(new PlaybackParameters(rate));
                DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                    .setUserAgent("X-MUSIC")
                    .setDefaultRequestProperties(WebDavAuth.playbackHeaders())
                    .setConnectTimeoutMs(15_000)
                    .setReadTimeoutMs(30_000)
                    .setAllowCrossProtocolRedirects(true);
                ProgressiveMediaSource source = new ProgressiveMediaSource.Factory(http)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
                exo.setMediaSource(source);
                exo.prepare();
                Log.i(TAG, "open " + url);
            } catch (RuntimeException e) {
                Log.e(TAG, "open failed", e);
                if (token == generation) emitError(4, e.getMessage() == null ? "FLAC 打不开" : e.getMessage());
            }
        });
        return token;
    }

    static void resume() {
        MAIN.post(() -> {
            wantPlay = true;
            ExoPlayer exo = player;
            if (exo == null) return;
            if (exo.getPlaybackState() == Player.STATE_ENDED) exo.seekTo(0);
            if (exo.getPlaybackState() == Player.STATE_READY || exo.getPlaybackState() == Player.STATE_BUFFERING) {
                exo.play();
                MAIN.removeCallbacks(TICK);
                MAIN.post(TICK);
            }
        });
    }

    static void pause() {
        MAIN.post(() -> {
            wantPlay = false;
            if (player != null) player.pause();
        });
    }

    static void seek(double seconds) {
        MAIN.post(() -> {
            long ms = Math.max(0, (long) (seconds * 1000));
            ExoPlayer exo = player;
            if (exo == null || exo.getPlaybackState() == Player.STATE_IDLE) {
                pendingSeekMs = ms;
                return;
            }
            exo.seekTo(ms);
            emitTime(exo);
        });
    }

    static void setVolume(float next) {
        volume = next;
        MAIN.post(() -> {
            if (player != null) player.setVolume(volume);
        });
    }

    static void setRate(float next) {
        rate = next <= 0 ? 1f : next;
        MAIN.post(() -> {
            if (player != null) player.setPlaybackParameters(new PlaybackParameters(rate));
        });
    }

    static void stop() {
        MAIN.post(() -> {
            generation += 1;
            wantPlay = false;
            pendingSeekMs = -1;
            MAIN.removeCallbacks(TICK);
            if (player != null) {
                player.pause();
                player.clearMediaItems();
            }
        });
    }

    private static ExoPlayer ensurePlayer(Context context) {
        if (player != null) return player;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(context).setEnableDecoderFallback(true);
        ExoPlayer exo = new ExoPlayer.Builder(context, renderers).build();
        exo.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true
        );
        exo.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (player != exo) return;
                if (state == Player.STATE_READY) {
                    if (pendingSeekMs >= 0) {
                        exo.seekTo(pendingSeekMs);
                        pendingSeekMs = -1;
                    }
                    if (readyGeneration != generation) {
                        readyGeneration = generation;
                        JSObject data = new JSObject();
                        data.put("duration", seconds(exo.getDuration()));
                        emit("flacReady", data);
                        Log.i(TAG, "ready durationMs=" + exo.getDuration());
                    }
                    if (wantPlay) exo.play();
                    MAIN.removeCallbacks(TICK);
                    MAIN.post(TICK);
                } else if (state == Player.STATE_ENDED) {
                    emit("flacEnded", new JSObject());
                }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (player != exo) return;
                boolean interrupted = reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS
                    || reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY;
                if (!playWhenReady && wantPlay && interrupted) {
                    wantPlay = false;
                    emit("flacPaused", new JSObject());
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (player != exo) return;
                Log.e(TAG, "playback error " + error.errorCode, error);
                emitError(codeOf(error), error.getErrorCodeName());
            }
        });
        player = exo;
        return exo;
    }

    private static void emitTime(ExoPlayer exo) {
        JSObject data = new JSObject();
        data.put("position", seconds(exo.getCurrentPosition()));
        data.put("duration", seconds(exo.getDuration()));
        data.put("buffered", seconds(exo.getBufferedPosition()));
        emit("flacTime", data);
    }

    private static void emitError(int code, String message) {
        JSObject data = new JSObject();
        data.put("code", code);
        data.put("message", message == null ? "" : message);
        emit("flacError", data);
    }

    private static void emit(String event, JSObject data) {
        data.put("generation", generation);
        sink.emit(event, data);
    }

    private static double seconds(long ms) {
        if (ms == C.TIME_UNSET || ms < 0) return 0;
        return ms / 1000.0;
    }

    private static int codeOf(PlaybackException error) {
        int code = error.errorCode;
        if (code >= 2000 && code < 3000) return 2;
        if (code >= 4000 && code < 5000) return 3;
        return 4;
    }
}
