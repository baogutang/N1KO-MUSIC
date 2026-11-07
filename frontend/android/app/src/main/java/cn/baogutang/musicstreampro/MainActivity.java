package cn.baogutang.musicstreampro;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WebDavPlugin.class);
        super.onCreate(savedInstanceState);
        installWebDavClient();
    }

    @Override
    public void onStart() {
        super.onStart();
        // 桥接层有时会在启动后再装自己的 WebViewClient，认证拦截要盖在那之后。
        installWebDavClient();
    }

    private void installWebDavClient() {
        if (getBridge() == null) return;
        WebView view = getBridge().getWebView();
        if (view == null) return;
        if (Build.VERSION.SDK_INT >= 26 && alreadyInstalled(view)) return;
        view.setWebViewClient(new WebDavWebViewClient(getBridge()));
    }

    @android.annotation.TargetApi(26)
    private static boolean alreadyInstalled(WebView view) {
        return view.getWebViewClient() instanceof WebDavWebViewClient;
    }
}
