package cn.baogutang.musicstreampro;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 告诉网页「这台是不是电视」（src/lib/tv.ts）。
 *
 * 系统的 UI 模式是电视，或者设备声明了 leanback（Android TV / Google TV 都有）就算。
 * 只看触屏有没有不够：有的电视盒子会谎报触屏，有的平板接了键盘也没有触屏。
 */
@CapacitorPlugin(name = "TvMode")
public class TvModePlugin extends Plugin {

    static boolean detect(Context context) {
        UiModeManager uiModeManager = (UiModeManager) context.getSystemService(Context.UI_MODE_SERVICE);
        if (uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            return true;
        }
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
    }

    @PluginMethod
    public void isTelevision(PluginCall call) {
        JSObject result = new JSObject();
        result.put("television", detect(getContext()));
        call.resolve(result);
    }
}
