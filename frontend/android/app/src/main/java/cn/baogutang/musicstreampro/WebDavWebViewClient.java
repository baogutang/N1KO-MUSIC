package cn.baogutang.musicstreampro;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * audio 标签和封面图不能自己带 Authorization。
 * 请求一旦落在已连接的 WebDAV 上，就由这里代为加上账号并原样转回，包括 Range。
 */
public class WebDavWebViewClient extends BridgeWebViewClient {
    public WebDavWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String target = request.getUrl().toString();
        if (!WebDavAuth.allows(target)) return super.shouldInterceptRequest(view, request);
        String method = request.getMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            String range = header(request, "Range");
            HttpURLConnection conn = WebDavAuth.openStream(target, method, range);
            int status = conn.getResponseCode();
            String mime = mimeOf(conn.getContentType(), target);
            Map<String, String> headers = new HashMap<>();
            copyHeader(conn, headers, "Content-Length");
            copyHeader(conn, headers, "Content-Range");
            copyHeader(conn, headers, "Accept-Ranges");
            if (!headers.containsKey("Accept-Ranges")) headers.put("Accept-Ranges", "bytes");
            headers.put("Access-Control-Allow-Origin", "*");
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(mime, null, status, reason(status), headers, stream);
        } catch (Exception e) {
            return new WebResourceResponse(
                "text/plain",
                "utf-8",
                502,
                "Bad Gateway",
                new HashMap<>(),
                new ByteArrayInputStream(new byte[0])
            );
        }
    }

    private static String header(WebResourceRequest request, String name) {
        Map<String, String> headers = request.getRequestHeaders();
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    private static void copyHeader(HttpURLConnection conn, Map<String, String> headers, String name) {
        String value = conn.getHeaderField(name);
        if (value != null) headers.put(name, value);
    }

    private static String mimeOf(String contentType, String url) {
        if (contentType != null && !contentType.isEmpty() && !contentType.startsWith("application/octet-stream")) {
            int semi = contentType.indexOf(';');
            return semi >= 0 ? contentType.substring(0, semi).trim() : contentType.trim();
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
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        return "application/octet-stream";
    }

    private static String reason(int status) {
        if (status == 200) return "OK";
        if (status == 206) return "Partial Content";
        if (status == 401) return "Unauthorized";
        if (status == 404) return "Not Found";
        return "Error";
    }
}
