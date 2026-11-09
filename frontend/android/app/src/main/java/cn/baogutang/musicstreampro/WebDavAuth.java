package cn.baogutang.musicstreampro;

import android.text.TextUtils;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV 的账号只活在内存里，每台 WebDAV 各一份（按连接地址记）。
 *
 * 只给连接地址下面的文件补账号：协议、主机、端口都相同，路径按段落在连接地址里面
 * （/music 管得到 /music/a.mp3，管不到 /music2/）。跳转时 OkHttp 换了主机就会丢掉 Authorization，
 * 账号不会被带到别的服务器上。
 */
final class WebDavAuth {
    static final String USER_AGENT = "N1KO-MUSIC";

    private static final String PROPFIND_BODY =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<d:propfind xmlns:d=\"DAV:\">"
            + "<d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/>"
            + "<d:getlastmodified/><d:getetag/></d:prop>"
            + "</d:propfind>";
    private static final int MAX_TEXT = 8_000_000;
    private static final MediaType XML = MediaType.parse("application/xml; charset=utf-8");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build();
    /** Depth: infinity 时服务器要先把整棵树走一遍才开始回，等得久一些 */
    private static final OkHttpClient TREE = CLIENT.newBuilder()
        .readTimeout(120, TimeUnit.SECONDS)
        .build();
    /** 播歌：对面停了一分钟没给数据就断开，不让转发线程永远挂着 */
    private static final OkHttpClient STREAM = CLIENT.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build();

    private static final Map<String, Credential> CREDENTIALS = new ConcurrentHashMap<>();
    private static final Object CHANGED = new Object();

    private WebDavAuth() {}

    static void configure(String base, String user, String pass) {
        HttpUrl url = HttpUrl.parse(base == null ? "" : base.trim());
        if (url == null) throw new IllegalArgumentException("bad WebDAV address");
        Credential credential = new Credential(url, user == null ? "" : user, pass == null ? "" : pass);
        CREDENTIALS.put(credential.key, credential);
        synchronized (CHANGED) {
            CHANGED.notifyAll();
        }
    }

    static boolean allows(String target) {
        return credentialFor(target) != null;
    }

    /**
     * 冷启动时页面可能先请求封面，网页那边的 configure 还在路上。
     * 封面拦截在后台线程上，等一会儿账号再判断，免得第一屏的封面全被拒掉。
     */
    static boolean awaitAllows(String target, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        synchronized (CHANGED) {
            while (credentialFor(target) == null) {
                long left = deadline - System.currentTimeMillis();
                if (left <= 0) return false;
                try {
                    CHANGED.wait(left);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
            return true;
        }
    }

    static HttpResult propfind(String url, String depth) throws IOException {
        Credential credential = require(url);
        String value = depth == null || depth.isEmpty() ? "1" : depth;
        Request request = authorized(url, credential)
            .method("PROPFIND", RequestBody.create(PROPFIND_BODY, XML))
            .header("Depth", value)
            .build();
        return execute("infinity".equalsIgnoreCase(value) ? TREE : CLIENT, request);
    }

    static HttpResult getText(String url) throws IOException {
        Credential credential = require(url);
        return execute(CLIENT, authorized(url, credential).build());
    }

    /** 只读文件开头，用来看歌手、专辑、歌名标签。body 是 Base64。 */
    static HttpResult getRange(String url, int length) throws IOException {
        Credential credential = require(url);
        int want = Math.min(Math.max(length, 1), 262144);
        Request request = authorized(url, credential)
            .header("Range", "bytes=0-" + (want - 1))
            .build();
        try (Response response = CLIENT.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            byte[] bytes = responseBody == null ? new byte[0] : readAtMost(responseBody.byteStream(), want);
            return new HttpResult(response.code(), Base64.encodeToString(bytes, Base64.NO_WRAP));
        }
    }

    /** 播歌和封面用。调用方负责关闭 Response。 */
    static Response openAuthorized(String url, String range) throws IOException {
        Credential credential = require(url);
        Request.Builder builder = authorized(url, credential);
        if (range != null && !range.isEmpty()) builder.header("Range", range);
        return STREAM.newCall(builder.build()).execute();
    }

    private static Credential require(String url) throws IOException {
        Credential credential = credentialFor(url);
        if (credential == null) throw new IOException("not under a connected WebDAV");
        return credential;
    }

    private static Request.Builder authorized(String url, Credential credential) {
        return new Request.Builder()
            .url(url)
            .header("Authorization", credential.header)
            .header("User-Agent", USER_AGENT);
    }

    /** 连接地址最长的那一份：同一台 NAS 上 /a 和 /a/b 各连了一次时，用更具体的那个账号 */
    private static Credential credentialFor(String target) {
        if (target == null) return null;
        HttpUrl url = HttpUrl.parse(target);
        if (url == null) return null;
        Credential best = null;
        for (Credential credential : CREDENTIALS.values()) {
            if (!credential.covers(url)) continue;
            if (best == null || credential.segments.size() > best.segments.size()) best = credential;
        }
        return best;
    }

    private static HttpResult execute(OkHttpClient client, Request request) throws IOException {
        try (Response response = client.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            String text = responseBody == null ? "" : readLimited(responseBody.byteStream());
            return new HttpResult(response.code(), text);
        }
    }

    private static String readLimited(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > MAX_TEXT) throw new IOException("WebDAV response too large");
            out.write(buf, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static byte[] readAtMost(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while (total < max && (n = in.read(buf, 0, Math.min(buf.length, max - total))) != -1) {
            out.write(buf, 0, n);
            total += n;
        }
        return out.toByteArray();
    }

    private static final class Credential {
        final String key;
        final String scheme;
        final String host;
        final int port;
        /** 连接地址的路径段（已解码，去掉空段） */
        final List<String> segments;
        final String header;

        Credential(HttpUrl base, String user, String pass) {
            scheme = base.scheme();
            host = base.host();
            port = base.port();
            segments = nonEmpty(base.pathSegments());
            key = scheme + "://" + host + ":" + port + "/" + TextUtils.join("/", segments);
            String token = user + ":" + pass;
            header = "Basic " + Base64.encodeToString(token.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        }

        boolean covers(HttpUrl url) {
            if (!scheme.equals(url.scheme()) || !host.equals(url.host()) || port != url.port()) return false;
            List<String> path = nonEmpty(url.pathSegments());
            if (path.size() < segments.size()) return false;
            for (int i = 0; i < segments.size(); i++) {
                if (!segments.get(i).equals(path.get(i))) return false;
            }
            return true;
        }

        private static List<String> nonEmpty(List<String> parts) {
            List<String> out = new ArrayList<>(parts.size());
            for (String part : parts) {
                if (!part.isEmpty()) out.add(part);
            }
            return out;
        }
    }

    static final class HttpResult {
        final int status;
        final String body;

        HttpResult(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
