package cn.baogutang.musicstreampro;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 局域网 IP 上的 http 服务器：封面和音频从这里取。
 *
 * App 的页面是 https://localhost。Chromium 对 https 页面里引用 http://IP 地址的图片、音频、视频一律拦下
 * （mixed_content_checker.cc：IP 地址不做 https 自动升级，也不看 WebView 的 MIXED_CONTENT_ALWAYS_ALLOW）。
 * 接口请求（XHR）不受这条限制，所以能登录、能列出歌，就是没有封面、放不出声。
 * 局域网 NAS 用 http://192.168.x.x 恰恰是最常见的装法，电视上尤其是。
 *
 * 网页把这类地址改写成同源的 https://localhost/_n1ko_lan/{主机:端口}/{路径}?{参数}（src/lib/lanMedia.ts），
 * 这里拦下来由原生去取。主机端口放在路径里而不是参数里：HLS 播放列表里的相对地址解析出来仍在这个前缀下。
 *
 * 这条路挂在 App 自己的源上，不能变成从局域网拿网页或脚本来执行的口子：
 * 只接子资源的 GET / HEAD、只认 IP 地址、只放行图片 / 音频 / 视频（和 HLS 播放列表），响应带 sandbox。
 */
final class LanMediaProxy {

    static final String PREFIX = "/_n1ko_lan/";

    private static final Pattern IPV4_AUTHORITY = Pattern.compile("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d{1,5})?$");
    private static final Pattern IPV6_AUTHORITY = Pattern.compile("^\\[[0-9a-fA-F:.%]+\\](:\\d{1,5})?$");
    private static final Pattern RANGE_START = Pattern.compile("^bytes=(\\d+)-");
    private static final Pattern CONTENT_RANGE = Pattern.compile("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$");

    /** 原样转给服务器的请求头：Range 是拖进度条要的，其余让服务器按 WebView 的口味回 */
    private static final String[] FORWARD_HEADERS = { "Range", "Accept", "User-Agent", "Accept-Language" };

    /** 原样带回 WebView 的响应头（Content-Length 不带：WebView 自己按 available() 和 Range 算） */
    private static final String[] RETURN_HEADERS = { "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified", "Expires" };

    private LanMediaProxy() {}

    static boolean handles(Uri url, String appHost) {
        String path = url.getPath();
        return path != null && path.startsWith(PREFIX) && appHost.equals(url.getHost());
    }

    static WebResourceResponse handle(WebResourceRequest request) {
        String method = request.getMethod();
        if (request.isForMainFrame() || !("GET".equals(method) || "HEAD".equals(method))) {
            return empty(405);
        }
        String target = targetUrl(request.getUrl());
        if (target == null) return empty(400);

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(target).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            String range = null;
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                for (String name : FORWARD_HEADERS) {
                    if (name.equalsIgnoreCase(header.getKey())) {
                        connection.setRequestProperty(name, header.getValue());
                        if ("Range".equals(name)) range = header.getValue();
                    }
                }
            }

            int status = connection.getResponseCode();
            String contentType = connection.getContentType();
            String mimeType = contentType == null ? "" : contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
            String encoding = null;
            if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("charset=")) {
                encoding = contentType.substring(contentType.toLowerCase(Locale.ROOT).indexOf("charset=") + 8).trim();
            }
            if (status >= 300 || !isMedia(mimeType)) {
                connection.disconnect();
                return empty(status >= 300 ? status : 415);
            }

            Map<String, String> headers = new HashMap<>();
            for (String name : RETURN_HEADERS) {
                String value = connection.getHeaderField(name);
                if (value != null) headers.put(name, value);
            }
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "sandbox; frame-ancestors 'none'");

            /*
             * WebView 自己处理 Range（components/embedder_support/android/util/input_stream_reader.cc）：
             * 用 available() 当整个文件的长度，再从流里 skip 掉 Range 起点之前的字节。
             * 服务器已经从起点开始回（206），这段 skip 就不能真的去读——交给 OffsetStream 记一笔账。
             */
            long rangeStart = rangeStart(range);
            long contentLength = connection.getContentLengthLong();
            long alreadySkipped = 0;
            long totalLength = -1;
            Matcher contentRange = CONTENT_RANGE.matcher(headers.containsKey("Content-Range") ? headers.get("Content-Range") : "");
            if (status == 206 && contentRange.matches()) {
                alreadySkipped = Long.parseLong(contentRange.group(1));
                totalLength = "*".equals(contentRange.group(3)) ? Long.parseLong(contentRange.group(2)) + 1 : Long.parseLong(contentRange.group(3));
            } else if (contentLength >= 0) {
                totalLength = contentLength;
                // 服务器不认 Range、回了整个文件：WebView 会自己读掉起点前的字节，这里补上 206，播放器才知道能拖
                if (range != null && rangeStart >= 0) {
                    if (rangeStart >= contentLength) {
                        connection.disconnect();
                        return empty(416);
                    }
                    status = 206;
                    headers.put("Content-Range", "bytes " + rangeStart + "-" + (contentLength - 1) + "/" + contentLength);
                }
            }

            InputStream body = "HEAD".equals(method)
                ? new ByteArrayInputStream(new byte[0])
                : new OffsetStream(connection.getInputStream(), alreadySkipped, totalLength, connection);
            return new WebResourceResponse(mimeType, encoding, status, reason(status), headers, body);
        } catch (IOException | IllegalArgumentException e) {
            if (connection != null) connection.disconnect();
            return empty(502);
        }
    }

    /** /_n1ko_lan/192.168.1.10:4533/rest/stream?id=1 → http://192.168.1.10:4533/rest/stream?id=1；不是 IP 地址就不认 */
    static String targetUrl(Uri url) {
        String path = url.getEncodedPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        String rest = path.substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String authority = Uri.decode(slash < 0 ? rest : rest.substring(0, slash));
        if (!IPV4_AUTHORITY.matcher(authority).matches() && !IPV6_AUTHORITY.matcher(authority).matches()) return null;
        String query = url.getEncodedQuery();
        return "http://" + authority + (slash < 0 ? "/" : rest.substring(slash)) + (query == null ? "" : "?" + query);
    }

    private static boolean isMedia(String mimeType) {
        return mimeType.startsWith("image/")
            || mimeType.startsWith("audio/")
            || mimeType.startsWith("video/")
            || mimeType.equals("application/octet-stream")
            || mimeType.equals("application/ogg")
            || mimeType.equals("application/vnd.apple.mpegurl")
            || mimeType.equals("application/x-mpegurl");
    }

    private static long rangeStart(String range) {
        if (range == null) return -1;
        Matcher m = RANGE_START.matcher(range.trim());
        return m.find() ? Long.parseLong(m.group(1)) : -1;
    }

    private static WebResourceResponse empty(int status) {
        // WebResourceResponse 不接受 3xx：重定向在 HttpURLConnection 里已经跟过了，还剩的只能算失败
        int code = status >= 300 && status < 400 ? 502 : status;
        return new WebResourceResponse("text/plain", "utf-8", code, reason(code), new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 415: return "Unsupported Media Type";
            case 416: return "Range Not Satisfiable";
            case 502: return "Bad Gateway";
            default: return status < 400 ? "OK" : "Error";
        }
    }

    /**
     * 服务器回的流，外加两件 WebView 要的事：
     * - available() 报整个文件的长度（WebView 拿它算 Content-Length 和 Range 的边界）
     * - 起点之前那段已经由服务器跳过了，WebView 再来 skip 时只记账、不读
     */
    private static final class OffsetStream extends InputStream {
        private final InputStream in;
        private final HttpURLConnection connection;
        private final long totalLength;
        private long virtualSkip;

        OffsetStream(InputStream in, long alreadySkipped, long totalLength, HttpURLConnection connection) {
            this.in = in;
            this.virtualSkip = alreadySkipped;
            this.totalLength = totalLength;
            this.connection = connection;
        }

        @Override
        public int available() {
            return totalLength > 0 ? (int) Math.min(totalLength, Integer.MAX_VALUE) : 0;
        }

        @Override
        public long skip(long n) throws IOException {
            if (n <= 0) return 0;
            if (virtualSkip > 0) {
                long taken = Math.min(n, virtualSkip);
                virtualSkip -= taken;
                return taken;
            }
            // 真要跳（服务器不认 Range）：网络流的 skip 可能半路返回 0，老老实实读掉
            byte[] buffer = new byte[(int) Math.min(n, 64 * 1024)];
            long skipped = 0;
            while (skipped < n) {
                int read = in.read(buffer, 0, (int) Math.min(buffer.length, n - skipped));
                if (read < 0) break;
                skipped += read;
            }
            return skipped;
        }

        @Override
        public int read() throws IOException {
            return in.read();
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            return in.read(b, off, len);
        }

        @Override
        public void close() throws IOException {
            try {
                in.close();
            } finally {
                connection.disconnect();
            }
        }
    }
}
