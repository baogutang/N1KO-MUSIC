# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

（一份 Vite + React 的网页应用，同一套前端分别打进 Tauri 桌面壳（macOS / Windows / Linux）、Capacitor 原生壳（iOS / iPadOS / Android）和 PWA。设计语言不按操作系统分叉，但要尊重 iPadOS / iOS 的使用习惯：44pt 命中区、安全区、侧滑与下拉收起、键盘快捷键、触控板右键与拖放。）

## Users

- **主用户是作者本人**：家里有 NAS（Navidrome / Jellyfin / Emby），同时用网易云、QQ 音乐账号听流媒体；主力设备是 iPad Pro 13（M4）、iPhone Duo（2026 年 9 月发布的折叠屏，内屏可分屏）、Mac。场景：沙发上 iPad 横屏长开着听、桌面上边工作边听、通勤时手机听、偶尔车载。
- **其次是开源用户**：同样自建 NAS、或没有 NAS 但有网易云 / QQ 账号的人，主要在中文环境里，Windows / Android / 网页也有人用。

他们的事：找到想听的（自己曲库 + 流媒体混在一起找），无摩擦地控制播放，把听歌这件事本身变得好受。

## Product Purpose

一个「愿意一直开着」的私人音乐播放器：把 NAS 曲库和流媒体账号聚合在一起播放，跨设备同步队列与听歌历史。成功的标准是用户把它当成每天的主力播放器，而不是偶尔打开的 NAS 前端。

## Positioning

- 聚合而不是二选一：多个音源同时连接，跨源搜索、推荐、队列；同一首歌跨源合并，按优先级播放（NAS 优先）。
- 音源即插件（MusicFree 兼容 + n1ko 扩展），沙箱运行，宿主按白名单代发请求。
- 原码直通（FLAC / WAV / ALAC），可选 320 / 192 / 128kbps 转码；ReplayGain 用服务器算好的增益。
- 完全免费、完全开源：不需要账号，没有埋点，没有会员和增值项。

## Operating Context

- 资料库浏览（首页、为你推荐、全部歌曲、专辑、歌手、歌单、收藏、最近播放、统计、搜索、排行榜）是工作界面；「正在播放」（全屏播放器、右侧面板、迷你播放条）是沉浸界面。
- 外壳按**窗口宽度**分三档，不按设备：<600 底部标签栏 + 迷你条；600–1023 侧边导航条；≥1024 侧栏 + 右侧「正在播放」面板。全屏播放器有 stack / portrait / landscape / tabletop（Duo 半折）四种排法。
- iPad 上接键盘与触控板：⌘ 快捷键表、⌃⌘S / ⌥⌘P / ⌘1–3 / ⌘F / ⌘L、歌曲行右键菜单、拖进「接下来」或侧栏歌单。
- 车载模式是独立的大按钮界面。
- 本地验收用 `scripts/mock-subsonic.mjs`（固定的中文假曲库，凭据随便填）+ 开发服务器。

## Capabilities and Constraints

- 保留不动：所有路由、store（zustand 持久化在 localStorage / IndexedDB，旧数据要能迁移）、hook、API 适配器（Subsonic / Jellyfin / Emby / 插件）、播放引擎（原生 `<audio>`，**不设 crossOrigin**，所以不能做基于 Web Audio 的音频分析）、测试与快捷键。重构只换表现层。
- i18n：中文、英文等多语言（`frontend/src/i18n/locales`），界面文案走 `useT()`。
- 发布闸门：`npx tsc --noEmit`、`npm run lint`（`--max-warnings 0`）、`npx vitest run`、`npm run build` 四件全过才提交；版本号七处同步（`npm run check:versions`）。
- WebView 差异：iOS / macOS 是 WKWebView，Windows 是 WebView2，Linux 是 WebKitGTK；新特性（View Transitions、滚动驱动动画、WebGL）一律渐进增强、要有退路。
- 隐私：仓库里不得出现任何 NAS 地址、账号或凭据。

## Brand Commitments

- 名字 N1KO MUSIC，字标 N1KO；图标 `docs/logo.png`。
- 品牌色是**绿色系**，要年轻、活泼；2026-10-27 用户在对比 demo 后选定**亮青柠**为强调色。松绿、墨绿、青瓷这类沉稳色已被否决，香槟铜也被否决过。
- **不要拟物按钮**：不要橡胶键、渐变、受光边、凹槽。播放三角必须视觉居中。
- 目标观感：「非常高级、动效丝滑、大气、一看就是大厂出品」。对标的工艺水准：Apple Music、QQ 音乐主 App（不是 HD 版）、新版特斯拉 App。
- 图标只用 `@phosphor-icons/react`。

## Evidence on Hand

- 真实内容：README（中英）、官网 `website/`、v2–v5 历代截图 `docs/screenshots/`、设计史 `docs/redesign/`。
- 演示数据：`scripts/mock-subsonic.mjs` 的假曲库（假专辑、假封面、假歌词），只用于开发与截图，属于合成数据。
- 没有的东西，任何界面都不得编造：用户数、下载量、评分、用户评价、媒体报道、合作方 logo、性能数字。

## Product Principles

1. **音乐是主角**：封面和正在播放的那首歌给界面定颜色和光，外壳退后。
2. **一首歌是同一个物体**：它在播放条、面板、全屏、队列之间移动变形，而不是在每处各有一个互不相干的副本。
3. **像实物一样响应**：按下立刻有反馈；拖动跟手、松手保留速度、随时可以打断。
4. **聚合但诚实**：多源一视同仁地呈现，同时始终说得清一首歌来自哪里；数据撑不起的句子就不出现。
5. **免费且私密**：没有会员、没有埋点，不把任何凭据带出用户的设备。

## Accessibility & Inclusion

- 每个可交互元素有可见的键盘焦点；对话框焦点圈闭、背景 inert（Radix）。
- 尊重「减弱动态效果」：空间位移退成淡入淡出，但确认操作的反馈保留。
- 触控命中区 ≥ 44pt；不能只靠悬停才看得见的操作。
- 中西文混排：中文走系统苹方，长标题截断不撑破布局，数字用等宽数字。
