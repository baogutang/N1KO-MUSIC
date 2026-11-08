package cn.baogutang.musicstreampro;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 局域网 http://IP 上的封面和音频由原生代取（见 LanMediaProxy）；其余请求照旧交给 Capacitor
        Bridge bridge = getBridge();
        String appHost = bridge.getHost();
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (LanMediaProxy.handles(request.getUrl(), appHost)) return LanMediaProxy.handle(request);
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
