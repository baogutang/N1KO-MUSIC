package cn.baogutang.musicstreampro;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.util.Log;
import android.util.LruCache;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * WebDAV 文件的两条代取路。两条都只认已连接的 WebDAV 下面的文件（WebDavAuth.allows）。
 *
 * 1. 播歌：127.0.0.1 上的小服务器。audio 标签和 ExoPlayer 都不会带账号，
 *    播放地址改成 http://127.0.0.1:端口/play?t=口令&u=文件地址，这里补上账号把流转回去，Range 照转。
 *    口令每次启动随机生成：本机别的 App 扫得到端口，没有口令也拿不到 NAS 上的文件。
 *    带 s=尺寸 时取的是封面，缩小后回 JPEG（给锁屏 / 通知栏，插件自己下载）。
 *
 * 2. 封面：页面里的 https://localhost/_n1ko_dav/{协议}/{主机:端口}/{路径}?s=尺寸，
 *    在 shouldInterceptRequest 里拦下（MainActivity）。同源，页面取色读得到像素；
 *    https 页面引用 http://IP 的图片会被 Chromium 当混合内容拦掉，这条路不经过那一关。
 */
final class WebDavProxy {
    static final String COVER_PREFIX = "/_n1ko_dav/";

    private static final String TAG = "WebDavProxy";
    private static final String TOKEN = randomToken();
    private static final int MAX_IMAGE_BYTES = 24 * 1024 * 1024;
    /** 缩好的封面留一份在内存里，列表来回滚动不用每次都去 NAS 取 */
    private static final LruCache<String, byte[]> COVERS = new LruCache<String, byte[]>(16 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return value.length;
        }
    };
    /** 原图也留一会儿：同一张封面列表要 64、播放页要 600、锁屏要 256，别为每个尺寸各下一次 */
    private static final LruCache<String, byte[]> ORIGINALS = new LruCache<String, byte[]>(24 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, byte[] value) {
            return value.length;
        }
    };
    private static volatile int port = -1;

    private WebDavProxy() {}

    /** 播放地址的前缀，后面接 URL 编码过的文件地址 */
    static String prefix() throws IOException {
        return "http://127.0.0.1:" + ensureStarted() + "/play?t=" + TOKEN + "&u=";
    }

    static String playUrl(String target) throws IOException {
        return prefix() + URLEncoder.encode(target, "UTF-8");
    }

    private static int ensureStarted() throws IOException {
        if (port > 0) return port;
        synchronized (WebDavProxy.class) {
            if (port > 0) return port;
            ServerSocket server = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            port = server.getLocalPort();
            Thread thread = new Thread(() -> acceptLoop(server), "webdav-proxy");
            thread.setDaemon(true);
            thread.start();
            return port;
        }
    }

    // ---- 页面里的封面：/_n1ko_dav/ ----

    static boolean handles(Uri url, String appHost) {
        String path = url.getPath();
        return path != null && path.startsWith(COVER_PREFIX) && appHost.equals(url.getHost());
    }

    static WebResourceResponse handle(WebResourceRequest request) {
        String method = request.getMethod();
        if (request.isForMainFrame() || !("GET".equals(method) || "HEAD".equals(method))) return empty(405);
        String target = coverTarget(request.getUrl());
        if (target == null || !WebDavAuth.awaitAllows(target, 5000)) return empty(403);
        int size = parseSize(request.getUrl().getQueryParameter("s"));
        try {
            Cover cover = cover(target, size);
            if (cover.status != 200) return empty(cover.status);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "private, max-age=86400");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "sandbox; frame-ancestors 'none'");
            InputStream body = "HEAD".equals(method) ? new ByteArrayInputStream(new byte[0]) : new ByteArrayInputStream(cover.bytes);
            return new WebResourceResponse(cover.mime, null, 200, "OK", headers, body);
        } catch (IOException | RuntimeException e) {
            return empty(502);
        }
    }

    /** /_n1ko_dav/http/192.168.1.3%3A5005/音乐/a/cover.jpg → http://192.168.1.3:5005/音乐/a/cover.jpg */
    static String coverTarget(Uri url) {
        String path = url.getEncodedPath();
        if (path == null || !path.startsWith(COVER_PREFIX)) return null;
        String rest = path.substring(COVER_PREFIX.length());
        int schemeEnd = rest.indexOf('/');
        if (schemeEnd <= 0) return null;
        String scheme = rest.substring(0, schemeEnd);
        if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
        rest = rest.substring(schemeEnd + 1);
        int hostEnd = rest.indexOf('/');
        if (hostEnd <= 0) return null;
        String authority = Uri.decode(rest.substring(0, hostEnd));
        if (authority.contains("/") || authority.contains("@")) return null;
        return scheme + "://" + authority + rest.substring(hostEnd);
    }

    // ---- 127.0.0.1 ----

    private static void acceptLoop(ServerSocket server) {
        while (!server.isClosed()) {
            try {
                Socket socket = server.accept();
                Thread worker = new Thread(() -> serve(socket), "webdav-proxy-conn");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException ignored) {
                if (server.isClosed()) return;
            }
        }
    }

    private static void serve(Socket socket) {
        Response upstream = null;
        try {
            socket.setSoTimeout(20000);
            InputStream in = new BufferedInputStream(socket.getInputStream());
            String[] lines = readHeaders(in).split("\r\n");
            if (lines.length == 0) return;
            String[] parts = lines[0].split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];
            boolean head = "HEAD".equalsIgnoreCase(method);
            if (!"GET".equalsIgnoreCase(method) && !head) {
                writeEmpty(socket, 405, "Method Not Allowed");
                return;
            }
            String token = query(path, "t");
            String target = query(path, "u");
            if (token == null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), TOKEN.getBytes(StandardCharsets.UTF_8))
                || target == null || !WebDavAuth.allows(target)) {
                writeEmpty(socket, 403, "Forbidden");
                return;
            }

            String sizeParam = query(path, "s");
            if (sizeParam != null) {
                Cover cover = cover(target, parseSize(sizeParam));
                if (cover.status != 200) {
                    writeEmpty(socket, cover.status, "Error");
                    return;
                }
                OutputStream out = new BufferedOutputStream(socket.getOutputStream());
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + cover.mime + "\r\nContent-Length: " + cover.bytes.length
                    + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                if (!head) out.write(cover.bytes);
                out.flush();
                return;
            }

            upstream = WebDavAuth.openAuthorized(target, header(lines, "Range"));
            int status = upstream.code();
            if (status >= 400) {
                writeEmpty(socket, status, "Error");
                return;
            }
            ResponseBody body = upstream.body();
            String length = upstream.header("Content-Length");
            String contentRange = upstream.header("Content-Range");
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());
            StringBuilder headers = new StringBuilder();
            headers.append("HTTP/1.1 ").append(status).append(' ').append(status == 206 ? "Partial Content" : "OK").append("\r\n");
            headers.append("Content-Type: ").append(mimeOf(upstream.header("Content-Type"), target)).append("\r\n");
            headers.append("Accept-Ranges: bytes\r\n");
            headers.append("Connection: close\r\n");
            if (length != null) headers.append("Content-Length: ").append(length).append("\r\n");
            if (contentRange != null) headers.append("Content-Range: ").append(contentRange).append("\r\n");
            headers.append("\r\n");
            out.write(headers.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (!head && body != null) {
                byte[] buf = new byte[16384];
                InputStream data = body.byteStream();
                int n;
                while ((n = data.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
            }
            out.flush();
        } catch (Exception e) {
            // 拖动进度时播放器会主动断开，不必当失败。别的错误记一条（不写地址，日志里不留 NAS 和口令）
            if (!(e instanceof IOException)) Log.e(TAG, "proxy failed", e);
        } finally {
            if (upstream != null) upstream.close();
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    // ---- 封面缩图 ----

    private static final class Cover {
        final int status;
        final String mime;
        final byte[] bytes;

        Cover(int status, String mime, byte[] bytes) {
            this.status = status;
            this.mime = mime;
            this.bytes = bytes;
        }
    }

    /** 取封面并按长边缩到 size（0 = 原图）。NAS 上的 cover.jpg 动辄几千像素、几 MB。 */
    private static Cover cover(String target, int size) throws IOException {
        String key = size + "|" + target;
        byte[] cached = COVERS.get(key);
        if (cached != null) return new Cover(200, sniffMime(cached), cached);
        byte[] original = ORIGINALS.get(target);
        if (original == null) {
            try (Response response = WebDavAuth.openAuthorized(target, null)) {
                if (response.code() != 200) return new Cover(response.code() >= 400 ? response.code() : 502, "", new byte[0]);
                ResponseBody body = response.body();
                if (body == null) return new Cover(502, "", new byte[0]);
                original = readAtMost(body.byteStream(), MAX_IMAGE_BYTES);
            }
            if (original.length <= 6 * 1024 * 1024) ORIGINALS.put(target, original);
        }
        byte[] bytes = size > 0 ? scaled(original, size) : original;
        String mime = sniffMime(bytes);
        if (!mime.startsWith("image/")) return new Cover(415, "", new byte[0]);
        COVERS.put(key, bytes);
        return new Cover(200, mime, bytes);
    }

    private static byte[] scaled(byte[] original, int size) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(original, 0, original.length, bounds);
        int longEdge = Math.max(bounds.outWidth, bounds.outHeight);
        if (longEdge <= 0 || longEdge <= size * 1.25) return original;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (longEdge / (options.inSampleSize * 2) >= size) options.inSampleSize *= 2;
        Bitmap decoded = BitmapFactory.decodeByteArray(original, 0, original.length, options);
        if (decoded == null) return original;
        Bitmap result = decoded;
        int decodedLong = Math.max(decoded.getWidth(), decoded.getHeight());
        if (decodedLong > size * 1.25) {
            float ratio = (float) size / decodedLong;
            result = Bitmap.createScaledBitmap(decoded, Math.max(1, Math.round(decoded.getWidth() * ratio)),
                Math.max(1, Math.round(decoded.getHeight() * ratio)), true);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        boolean alpha = result.hasAlpha();
        result.compress(alpha ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 88, out);
        if (result != decoded) result.recycle();
        decoded.recycle();
        return out.toByteArray();
    }

    private static String sniffMime(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8) return "image/jpeg";
        if (bytes.length >= 8 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') return "image/png";
        if (bytes.length >= 12 && bytes[0] == 'R' && bytes[1] == 'I' && bytes[2] == 'F' && bytes[3] == 'F'
            && bytes[8] == 'W' && bytes[9] == 'E' && bytes[10] == 'B' && bytes[11] == 'P') return "image/webp";
        if (bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') return "image/gif";
        return "application/octet-stream";
    }

    private static int parseSize(String value) {
        if (value == null) return 0;
        try {
            return Math.max(0, Math.min(Integer.parseInt(value), 2048));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // ---- 小工具 ----

    private static WebResourceResponse empty(int status) {
        return new WebResourceResponse("text/plain", "utf-8", status, status == 403 ? "Forbidden" : "Error",
            new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static void writeEmpty(Socket socket, int status, String reason) throws IOException {
        String head = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
        socket.getOutputStream().write(head.getBytes(StandardCharsets.ISO_8859_1));
    }

    private static String readHeaders(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int b;
        while ((b = in.read()) != -1) {
            sb.append((char) b);
            int n = sb.length();
            if (n >= 4 && sb.charAt(n - 4) == '\r' && sb.charAt(n - 3) == '\n' && sb.charAt(n - 2) == '\r' && b == '\n') break;
            if (n > 65536) break;
        }
        return sb.toString();
    }

    private static String header(String[] lines, String name) {
        String prefix = name.toLowerCase(Locale.US) + ":";
        for (int i = 1; i < lines.length; i++) {
            if (lines[i].toLowerCase(Locale.US).startsWith(prefix)) {
                return lines[i].substring(name.length() + 1).trim();
            }
        }
        return null;
    }

    private static String query(String path, String key) throws IOException {
        int q = path.indexOf('?');
        if (q < 0) return null;
        for (String pair : path.substring(q + 1).split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            if (key.equals(pair.substring(0, eq))) return URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
        }
        return null;
    }

    private static byte[] readAtMost(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > max) throw new IOException("image too large");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static String mimeOf(String contentType, String url) {
        if (contentType != null && !contentType.isEmpty() && !contentType.startsWith("application/octet-stream")) {
            int semi = contentType.indexOf(';');
            return (semi >= 0 ? contentType.substring(0, semi) : contentType).trim();
        }
        String path = url.toLowerCase(Locale.US);
        int query = path.indexOf('?');
        if (query >= 0) path = path.substring(0, query);
        if (path.endsWith(".mp3")) return "audio/mpeg";
        if (path.endsWith(".flac")) return "audio/flac";
        if (path.endsWith(".wav")) return "audio/wav";
        if (path.endsWith(".m4a") || path.endsWith(".aac") || path.endsWith(".alac")) return "audio/mp4";
        if (path.endsWith(".ogg") || path.endsWith(".oga")) return "audio/ogg";
        if (path.endsWith(".opus")) return "audio/opus";
        return "application/octet-stream";
    }

    private static String randomToken() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.US, "%02x", b & 0xff));
        return out.toString();
    }
}
