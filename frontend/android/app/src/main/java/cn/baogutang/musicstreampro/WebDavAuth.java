package cn.baogutang.musicstreampro;

import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 极空间 WebDAV 的账号只活在内存里。
 * 目录用 PROPFIND，播歌和封面由 WebView 拦截 GET 时补上同一份认证。
 */
final class WebDavAuth {
    private static final String PROPFIND_BODY =
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
            + "<d:propfind xmlns:d=\"DAV:\">"
            + "<d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/></d:prop>"
            + "</d:propfind>";
    private static final int MAX_TEXT = 8_000_000;
    private static final MediaType XML = MediaType.parse("application/xml; charset=utf-8");
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build();
    private static final OkHttpClient STREAM = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .followRedirects(true)
        .build();

    private static volatile String baseUrl = "";
    private static volatile String username = "";
    private static volatile String password = "";

    private WebDavAuth() {}

    static void configure(String base, String user, String pass) {
        baseUrl = trimSlash(base == null ? "" : base.trim());
        username = user == null ? "" : user;
        password = pass == null ? "" : pass;
    }

    static java.util.Map<String, String> playbackHeaders() {
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Authorization", basic());
        headers.put("User-Agent", "N1KO-MUSIC");
        return headers;
    }

    static boolean allows(String target) {
        String base = baseUrl;
        if (base.isEmpty() || target == null) return false;
        if (!target.startsWith("http://") && !target.startsWith("https://")) return false;
        return target.equals(base) || target.startsWith(base + "/");
    }

    static HttpResult propfind(String url, String depth) throws IOException {
        if (!allows(url)) throw new IOException("地址不在已连接的 WebDAV 里");
        Request request = new Request.Builder()
            .url(url)
            .method("PROPFIND", RequestBody.create(PROPFIND_BODY, XML))
            .header("Depth", depth == null || depth.isEmpty() ? "1" : depth)
            .header("Authorization", basic())
            .header("User-Agent", "N1KO-MUSIC")
            .build();
        return execute(request);
    }

    static HttpResult getText(String url) throws IOException {
        if (!allows(url)) throw new IOException("地址不在已连接的 WebDAV 里");
        Request request = new Request.Builder()
            .url(url)
            .header("Authorization", basic())
            .header("User-Agent", "N1KO-MUSIC")
            .build();
        return execute(request);
    }

    /** 只读文件开头，用来看歌手、专辑、歌名标签。body 是 Base64。 */
    static HttpResult getRange(String url, int length) throws IOException {
        if (!allows(url)) throw new IOException("地址不在已连接的 WebDAV 里");
        int want = Math.min(Math.max(length, 1), 262144);
        Request request = new Request.Builder()
            .url(url)
            .header("Range", "bytes=0-" + (want - 1))
            .header("Authorization", basic())
            .header("User-Agent", "N1KO-MUSIC")
            .build();
        try (Response response = STREAM.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            byte[] bytes = responseBody == null ? new byte[0] : readAtMost(responseBody.byteStream(), want);
            return new HttpResult(response.code(), android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
        }
    }

    private static HttpResult execute(Request request) throws IOException {
        try (Response response = CLIENT.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            String text = responseBody == null ? "" : readLimited(responseBody.byteStream());
            return new HttpResult(response.code(), text);
        }
    }

    /** 播歌用。调用方负责关闭 Response。 */
    static Response openAuthorized(String url, String range) throws IOException {
        if (!allows(url)) throw new IOException("地址不在已连接的 WebDAV 里");
        Request.Builder builder = new Request.Builder()
            .url(url)
            .header("Authorization", basic())
            .header("User-Agent", "N1KO-MUSIC");
        if (range != null && !range.isEmpty()) builder.header("Range", range);
        return STREAM.newCall(builder.build()).execute();
    }

    static HttpURLConnection openStream(String url, String method, String range) throws IOException {
        if (!allows(url)) throw new IOException("地址不在已连接的 WebDAV 里");
        HttpURLConnection conn = open(url, method);
        if (range != null && !range.isEmpty()) conn.setRequestProperty("Range", range);
        return conn;
    }

    private static HttpURLConnection open(String url, String method) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(120_000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", basic());
        conn.setRequestProperty("User-Agent", "N1KO-MUSIC");
        return conn;
    }

    private static String basic() {
        String token = username + ":" + password;
        String encoded = Base64.encodeToString(token.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        return "Basic " + encoded;
    }

    private static String readLimited(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > MAX_TEXT) throw new IOException("WebDAV 响应太大");
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

    private static String trimSlash(String value) {
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
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
