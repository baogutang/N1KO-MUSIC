package cn.baogutang.musicstreampro;

import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 给网页里的 WebDAV 适配器列目录、读歌词和标签，并控制 FLAC 播放。
 *
 * Capacitor 的插件方法都排在同一条线程上。网络请求要是直接在那里跑，
 * 扫曲库时读几千个文件头会把其他插件（通知栏、状态栏……）的调用全堵在后面，
 * 网页那边开的并发也成了一个一个排队。所以联网的活都交给自己的线程池。
 */
@UnstableApi
@CapacitorPlugin(name = "WebDav")
public class WebDavPlugin extends Plugin {
    private final ExecutorService network = Executors.newFixedThreadPool(6, runnable -> {
        Thread thread = new Thread(runnable, "webdav-net");
        thread.setDaemon(true);
        return thread;
    });

    @Override
    public void load() {
        WebDavFlacPlayer.setSink((event, data) -> notifyListeners(event, data));
    }

    @Override
    protected void handleOnDestroy() {
        WebDavFlacPlayer.release();
        network.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String base = call.getString("baseUrl");
        String username = call.getString("username");
        String password = call.getString("password");
        if (base == null || username == null || password == null) {
            call.reject("missing WebDAV address or account");
            return;
        }
        try {
            WebDavAuth.configure(base, username, password);
            JSObject ret = new JSObject();
            ret.put("proxy", WebDavProxy.prefix());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "configure failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void propfind(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("missing url");
            return;
        }
        String depth = call.getString("depth");
        if (depth == null) {
            Integer numeric = call.getInt("depth");
            depth = numeric == null ? "1" : String.valueOf(numeric);
        }
        String value = depth;
        network.execute(() -> respond(call, () -> WebDavAuth.propfind(url, value)));
    }

    @PluginMethod
    public void getText(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("missing url");
            return;
        }
        network.execute(() -> respond(call, () -> WebDavAuth.getText(url)));
    }

    @PluginMethod
    public void getRange(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("missing url");
            return;
        }
        Integer length = call.getInt("length");
        int want = length == null ? 65536 : length;
        network.execute(() -> respond(call, () -> WebDavAuth.getRange(url, want)));
    }

    @PluginMethod
    public void openFlac(PluginCall call) {
        String target = call.getString("target");
        if (target == null || !WebDavAuth.allows(target)) {
            call.reject("not under a connected WebDAV");
            return;
        }
        if (getContext() == null) {
            call.reject("player not ready");
            return;
        }
        float volume = call.getDouble("volume", 1d).floatValue();
        float rate = call.getDouble("rate", 1d).floatValue();
        try {
            // ExoPlayer 也走 127.0.0.1：账号只在代取那一层加，跳转到别的主机时不会被带过去
            int generation = WebDavFlacPlayer.open(getContext(), WebDavProxy.playUrl(target), volume, rate);
            JSObject ret = new JSObject();
            ret.put("generation", generation);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "open failed" : e.getMessage());
        }
    }

    @PluginMethod
    public void resumeFlac(PluginCall call) {
        WebDavFlacPlayer.resume();
        call.resolve();
    }

    @PluginMethod
    public void pauseFlac(PluginCall call) {
        WebDavFlacPlayer.pause();
        call.resolve();
    }

    @PluginMethod
    public void seekFlac(PluginCall call) {
        Double seconds = call.getDouble("seconds");
        WebDavFlacPlayer.seek(seconds == null ? 0 : seconds);
        call.resolve();
    }

    @PluginMethod
    public void volumeFlac(PluginCall call) {
        WebDavFlacPlayer.setVolume(call.getDouble("volume", 1d).floatValue());
        call.resolve();
    }

    @PluginMethod
    public void rateFlac(PluginCall call) {
        WebDavFlacPlayer.setRate(call.getDouble("rate", 1d).floatValue());
        call.resolve();
    }

    @PluginMethod
    public void stopFlac(PluginCall call) {
        WebDavFlacPlayer.stop();
        call.resolve();
    }

    private interface Request {
        WebDavAuth.HttpResult run() throws Exception;
    }

    private static void respond(PluginCall call, Request request) {
        try {
            WebDavAuth.HttpResult result = request.run();
            JSObject ret = new JSObject();
            ret.put("status", result.status);
            ret.put("body", result.body);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "request failed" : e.getMessage());
        }
    }
}
