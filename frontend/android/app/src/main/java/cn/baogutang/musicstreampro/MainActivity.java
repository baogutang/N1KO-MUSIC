package cn.baogutang.musicstreampro;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 应用内的插件要在 super.onCreate 建桥之前注册
        registerPlugin(TvModePlugin.class);
        registerPlugin(WebDavPlugin.class);
        super.onCreate(savedInstanceState);

        // 局域网 http://IP 上的封面和音频由原生代取（见 LanMediaProxy）；其余请求照旧交给 Capacitor
        Bridge bridge = getBridge();
        String appHost = bridge.getHost();
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (LanMediaProxy.handles(request.getUrl(), appHost)) return LanMediaProxy.handle(request);
                // WebDAV 的封面要补账号（见 WebDavProxy）
                if (WebDavProxy.handles(request.getUrl(), appHost)) return WebDavProxy.handle(request);
                return super.shouldInterceptRequest(view, request);
            }
        });

        /*
         * 电视：让网页里的 <meta name="viewport" content="width=960"> 生效。
         * 各家电视盒子的屏幕密度从 1 到 2 都有，同一套界面有的电视上正常、有的只有一半大；
         * 网页（src/components/tv/TvModeEffects.tsx）把布局视口钉在 960 宽，WebView 按屏幕宽度缩放。
         * WebView 默认不认 viewport 的 width，要先打开宽视口。
         */
        if (TvModePlugin.detect(this)) {
            WebSettings settings = bridge.getWebView().getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
        }
    }
}
