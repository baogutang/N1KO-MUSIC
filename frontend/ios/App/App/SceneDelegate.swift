import UIKit
import Capacitor

/**
 * 场景生命周期（UIScene）。iOS 27 起，用 27 SDK 编译、却还走老的「整个 App 一个窗口」的 App 一打开就被系统拦下崩掉
 * （_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption）。
 *
 * 窗口照旧从 Main.storyboard 建（Info.plist 的 UISceneStoryboardFile），首页还是 AppViewController，
 * 系统在 willConnectTo 之前就把它挂到 window 上了，这里不用自己建。
 * 场景化之后，n1ko:// 链接和通用链接不再进 AppDelegate，改由这里转给 Capacitor（App 插件的 appUrlOpen 靠它）。
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // 冷启动带着链接打开时，链接在 connectionOptions 里，Capacitor 等插件就绪后再补发
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
