import UIKit
import Capacitor

/**
 * 换掉 storyboard 里的 CAPBridgeViewController，只多做一件事：
 * 窗口尺寸或前后台切换之后，让 WKWebView 把自己的几何重新同步一遍。
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
