package cn.baogutang.musicstreampro;

import androidx.media3.common.util.UnstableApi;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 给网页里的 WebDAV 适配器列目录、读歌词。播歌不走这里。 */
@UnstableApi
@CapacitorPlugin(name = "WebDav")
public class WebDavPlugin extends Plugin {
    @Override
    public void load() {
        WebDavFlacPlayer.setSink((event, data) -> notifyListeners(event, data));
    }
    @PluginMethod
    public void configure(PluginCall call) {
        String base = call.getString("baseUrl");
        String username = call.getString("username");
        String password = call.getString("password");
        if (base == null || username == null || password == null) {
            call.reject("缺少 WebDAV 连接信息");
            return;
        }
        WebDavAuth.configure(base, username, password);
        call.resolve();
    }

    @PluginMethod
    public void propfind(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("缺少目录地址");
            return;
        }
        String depth = call.getString("depth");
        if (depth == null) {
            Integer numeric = call.getInt("depth");
            depth = numeric == null ? "1" : String.valueOf(numeric);
        }
        try {
            WebDavAuth.HttpResult result = WebDavAuth.propfind(url, depth);
            JSObject ret = new JSObject();
            ret.put("status", result.status);
            ret.put("body", result.body);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "PROPFIND 失败" : e.getMessage());
        }
    }

    @PluginMethod
    public void getText(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("缺少文件地址");
            return;
        }
        try {
            WebDavAuth.HttpResult result = WebDavAuth.getText(url);
            JSObject ret = new JSObject();
            ret.put("status", result.status);
            ret.put("body", result.body);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "读取失败" : e.getMessage());
        }
    }

    @PluginMethod
    public void streamUrl(PluginCall call) {
        String target = call.getString("target");
        if (target == null || !WebDavAuth.allows(target)) {
            call.reject("无法播放这个地址");
            return;
        }
        try {
            int port = WebDavProxy.ensureStarted();
            String encoded = java.net.URLEncoder.encode(target, "UTF-8");
            JSObject ret = new JSObject();
            ret.put("url", "http://127.0.0.1:" + port + "/play?u=" + encoded);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "播放通道没打开" : e.getMessage());
        }
    }

    @PluginMethod
    public void openFlac(PluginCall call) {
        String target = call.getString("target");
        if (target == null || !WebDavAuth.allows(target)) {
            call.reject("无法播放这个地址");
            return;
        }
        if (getContext() == null) {
            call.reject("播放器还没准备好");
            return;
        }
        float volume = call.getDouble("volume", 1d).floatValue();
        float rate = call.getDouble("rate", 1d).floatValue();
        int generation = WebDavFlacPlayer.open(getContext(), target, volume, rate);
        JSObject ret = new JSObject();
        ret.put("generation", generation);
        call.resolve(ret);
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
}
