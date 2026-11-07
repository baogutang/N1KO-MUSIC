package cn.baogutang.musicstreampro;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * 安卓的 audio 标签不会走 WebView 拦截，极空间收不到账号。
 * 播放地址改成 127.0.0.1，由这里补上认证再把音频流转回去。
 */
final class WebDavProxy {
    private static volatile int port = -1;

    private WebDavProxy() {}

    static int ensureStarted() throws IOException {
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

    private static void acceptLoop(ServerSocket server) {
        while (!server.isClosed()) {
            try {
                Socket socket = server.accept();
                Thread worker = new Thread(() -> handle(socket), "webdav-proxy-conn");
                worker.setDaemon(true);
                worker.start();
            } catch (IOException ignored) {
                if (server.isClosed()) return;
            }
        }
    }

    private static void handle(Socket socket) {
        Response upstream = null;
        try {
            socket.setSoTimeout(20000);
            InputStream in = new BufferedInputStream(socket.getInputStream());
            String request = readHeaders(in);
            String[] lines = request.split("\r\n");
            if (lines.length == 0) return;
            String[] parts = lines[0].split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];
            String range = header(lines, "Range");
            if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                writeStatus(socket, 405, "text/plain", "Method Not Allowed", null, null);
                return;
            }
            String target = query(path, "u");
            if (target == null || !WebDavAuth.allows(target)) {
                writeStatus(socket, 403, "text/plain", "Forbidden", null, null);
                return;
            }
            upstream = WebDavAuth.openAuthorized(target, range);
            int status = upstream.code();
            ResponseBody body = upstream.body();
            String mime = mimeOf(upstream.header("Content-Type"), target);
            String length = upstream.header("Content-Length");
            String contentRange = upstream.header("Content-Range");
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());
            String reason = status == 206 ? "Partial Content" : status == 200 ? "OK" : "Error";
            StringBuilder head = new StringBuilder();
            head.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
            head.append("Content-Type: ").append(mime).append("\r\n");
            head.append("Accept-Ranges: bytes\r\n");
            head.append("Connection: close\r\n");
            if (length != null) head.append("Content-Length: ").append(length).append("\r\n");
            if (contentRange != null) head.append("Content-Range: ").append(contentRange).append("\r\n");
            head.append("\r\n");
            out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (!"HEAD".equalsIgnoreCase(method) && body != null && status < 400) {
                byte[] buf = new byte[16384];
                InputStream data = body.byteStream();
                int n;
                while ((n = data.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
            }
            out.flush();
        } catch (IOException ignored) {
            // 拖动进度时播放器会主动断开，不必当失败
        } finally {
            if (upstream != null) upstream.close();
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static void writeStatus(Socket socket, int status, String mime, String reason, String length, String contentRange) throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ").append(mime).append("\r\n");
        head.append("Connection: close\r\n");
        head.append("Content-Length: 0\r\n\r\n");
        socket.getOutputStream().write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
    }

    private static String readHeaders(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int prev = 0;
        int b;
        while ((b = in.read()) != -1) {
            sb.append((char) b);
            if (prev == '\r' && b == '\n' && sb.toString().endsWith("\r\n\r\n")) break;
            if (sb.length() > 65536) break;
            prev = b;
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
        String[] pairs = path.substring(q + 1).split("&");
        for (String pair : pairs) {
            int eq = pair.indexOf('=');
            if (eq < 0) continue;
            if (key.equals(pair.substring(0, eq))) {
                return URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
            }
        }
        return null;
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
}
