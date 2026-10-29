import UIKit
import WebKit
import Capacitor

/**
 * 换掉 storyboard 里的 CAPBridgeViewController，多做两件事。
 *
 * 一、网页按屏幕的刷新率出帧（见 unlockHighRefreshRendering）。
 *
 * 二、窗口尺寸或前后台切换之后，让 WKWebView 把自己的几何重新同步一遍。
 *
 * iPadOS 上把 App 划回后台（三指 / 上滑回主屏幕）时，系统会把场景缩小再放回原尺寸。
 * WebKit 在这一来一回里留下了过时的「可见区域」：排版已经按满屏重排，
 * 合成层的绘制范围和固定 / 吸附层的位置却还停在中间那个小尺寸上。表现是：
 * - 底部播放条整条不见（它整个落在旧可见区域之外，不再上屏）；
 * - 全屏播放器右边留一条没画，透出底下「正在播放」面板。
 * 网页这边量到的尺寸全都正确，JS 里修不了；只有让 WKWebView 再经历一次真实的尺寸变化，
 * 它才会重新计算可见区域、重铺图块、重摆固定层。
 */
class AppViewController: CAPBridgeViewController {

    private var wentToBackground = false

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        let unlocked = Self.unlockHighRefreshRendering(configuration.preferences)
        print("[N1KO] page rendering updates follow the display: \(unlocked)")
        return configuration
    }

    /**
     * WKWebView 默认把网页的渲染更新压在每秒 60 次左右（WebKit 内部的 PreferPageRenderingUpdatesNear60FPSEnabled；
     * Safari 能在「功能标志」里关，嵌在 App 里的 WKWebView 没有公开开关，WebKit bug 294338 至今没给）。
     * iPad Pro、iPhone Pro 的屏是 120Hz：原生滚动、系统动画都是 120 帧，网页里一帧一帧算的东西——
     * 横屏卡片叠的拖动和吸附、各处的弹簧——却只有 60 帧，手指一动就比系统慢半拍、一顿一顿的。
     * 这里通过 WebKit 的私有接口（和 Safari 的功能标志同一条路）把这一项关掉，渲染更新跟着屏幕走。
     * 不是 120Hz 的屏、低电量模式，系统自己会降下来；找不到这一项（系统改了）就什么也不做，退回 60 帧。
     * 返回是否改成功了。
     */
    private static func unlockHighRefreshRendering(_ preferences: WKPreferences) -> Bool {
        let featuresSelector = NSSelectorFromString("_features")
        let setSelector = NSSelectorFromString("_setEnabled:forFeature:")
        let getSelector = NSSelectorFromString("_isEnabledForFeature:")
        let keySelector = NSSelectorFromString("key")
        let preferencesClass: AnyObject = WKPreferences.self
        guard preferencesClass.responds(to: featuresSelector),
              preferences.responds(to: setSelector),
              let features = preferencesClass.perform(featuresSelector)?.takeUnretainedValue() as? [NSObject] else { return false }
        for feature in features where feature.responds(to: keySelector) {
            guard (feature.perform(keySelector)?.takeUnretainedValue() as? String) == "PreferPageRenderingUpdatesNear60FPSEnabled" else { continue }
            // BOOL 参数不能走 perform(_:with:with:)（那会把一个对象指针当成 BOOL 传过去），按 C 函数调
            typealias Setter = @convention(c) (AnyObject, Selector, Bool, AnyObject) -> Void
            unsafeBitCast(preferences.method(for: setSelector), to: Setter.self)(preferences, setSelector, false, feature)
            guard preferences.responds(to: getSelector) else { return true }
            typealias Getter = @convention(c) (AnyObject, Selector, AnyObject) -> Bool
            return !unsafeBitCast(preferences.method(for: getSelector), to: Getter.self)(preferences, getSelector, feature)
        }
        return false
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(sceneDidEnterBackground), name: UIScene.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(sceneDidActivate), name: UIScene.didActivateNotification, object: nil)
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        // 旋转、分屏、台前调度拖窗口：动画结束后再同步一次
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.resyncWebViewGeometry()
        }
    }

    @objc private func sceneDidEnterBackground() {
        wentToBackground = true
    }

    @objc private func sceneDidActivate() {
        // 只管「从后台回来」；拉下控制中心之类的短暂失活不动它
        guard wentToBackground else { return }
        wentToBackground = false
        // 等系统把场景尺寸放回去、WebKit 恢复绘制之后再做
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            self?.resyncWebViewGeometry()
        }
    }

    /// 高度先少 1pt、下一拍再还原：分两拍是因为同一拍里改了又改回，WebKit 只看到最终尺寸，等于没动
    private func resyncWebViewGeometry() {
        guard let webView = webView, webView.window != nil else { return }
        let frame = webView.frame
        webView.frame = CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height - 1)
        DispatchQueue.main.async {
            webView.frame = frame
        }
    }
}
