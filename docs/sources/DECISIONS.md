# 多音源聚合：过程决定记录

执行方在实施中偏离 PLAN.md 或 PROTOCOL.md 时，在这里追加一条。格式：

```
## YYYY-MM-DD · 阶段 x.y · 一句话标题
- 冲突：计划说 A，代码现实是 B
- 选择：选了 C
- 原因：…
- 影响：哪些文件、要不要回头改文档
```

## 2026-09-02 · 立项 · 已拍板的范围

- 汽水音乐与 Apple Music 不在第一批（原因见 PLAN.md §1）。
- 插件开发期放本仓库 `plugins/`，发布前再拆成独立仓库。
- 搜索结果按来源分组并提供「全部」切换。

## 2026-09-02 · 阶段 0.3 · 异步过期重取的浏览器验证顺延到阶段 1
- 冲突：0.3 验收要求「用假适配器（resolveStreamUrl 返回 5 秒后过期的 data: URL）在浏览器里验证过期重取」，但阶段 0 没有任何异步取流型适配器可注册进真实应用。
- 选择：过期判断、缓存 key、同步/异步解析分派在 utils 单测里覆盖（audioEngine.test.ts）；完整浏览器链路留给阶段 1 的 Mock 插件（其验收项恰好是「expiresAt 设 20 秒以便测过期重取」）。
- 原因：阶段 0 不引入测试专用的注册后门；Mock 插件本来就是为这条路径设计的。
- 影响：无需回头改文档；阶段 1 验收时一并报告。

## 2026-09-02 · 阶段 1.3 · 插件 Artist 的拼音首字母暂降级为 '#'
- 冲突：PROTOCOL §5.2 要求宿主按名称首字符（拼音首字母）生成 sortIndex，但 Node 与浏览器的 ICU 都把汉字整体排在拉丁之前（collator 边界法取不到字母段），经典「边界字」表法依赖 GB2312 编码序而 JS 拿不到 GBK 码位——无依赖做不到全量准确的拼音首字母。
- 选择：拉丁名按首字母归位，中文与其余归 '#'（'#' 组内部仍可用 Intl.Collator('zh-u-co-pinyin') 排对顺序）；正式拼音数据表顺延到阶段 3（网易云的中文歌手真正进入聚合视图时，届时引入紧凑表或拼音库，与 N1KO 确认选型）。
- 原因：阶段 1 插件音源不走歌手浏览页（libraryBrowse=false），sortIndex 实际不参与渲染；先不为此引入新依赖。
- 影响：frontend/src/plugins/mapping.ts 的 pinyinInitial 与其测试；无需改协议文档（PROTOCOL 未规定实现方式）。

## 2026-09-02 · 阶段 1.2 · 白名单加了私网/回环拒绝（协议未提，SSRF 防线）
- 冲突：PROTOCOL §2/§8 只说 hosts 域名白名单，未提私网地址；安全扫描亦要求。
- 选择：whitelist.ts 在域名匹配外一律拒绝 localhost/127./10./192.168./172.16-31./169.254./::1/fe80::/.local/.internal——即使 manifest 写了也不放行。
- 原因：插件音源全部是公网 API；堵住「恶意 manifest 指向内网服务」与本地元数据端点。本地测试走 Mock 插件（data: URL，不出网）。
- 影响：whitelist.ts + 双端（宿主/开发代理）共用；需要回头在 PROTOCOL §2 补一句「私网与回环地址一律拒绝」。

## 2026-09-02 · 阶段 0.2 · IssueEntry 增 serverId 字段
- 冲突：Issue 页封面按条目来源解析适配器（0.2 分类改造），但 services/issue.ts 的 IssueEntry 是从听歌事件聚合出的精简形状，没有 serverId。
- 选择：给 IssueEntry 增可选 serverId，由 rank / topArtists / topAlbums 从 song.serverId 透传。
- 原因：比「Issue 页永远打主库」更正确——听歌历史本就跨服务器（审计 高-4 同源问题）。
- 影响：services/issue.ts 一处类型 + 三处赋值；无需改协议文档。

## 2026-09-02 · 阶段 1.6 · 播放优先级设置顺延到 2.6
- 冲突：PLAN §195 把「播放优先级」列进 1.6 的 SourcesSettings 范围，§207 又把它列在 2.6（主库选择器同处）。
- 选择：按 2.6 落地，SourcesSettings 本阶段不含优先级 UI。
- 原因：优先级只在「同一首歌多来源」时才有意义，聚合视图与 match.ts 是阶段 2 的事；提前做一个没有消费方的设置项只会返工。
- 影响：无需改文档（PLAN 两处本就矛盾，以 2.6 为准）；2.6 做主库选择器时一并实现。

## 2026-09-02 · 阶段 1.6 · 沙箱产物关闭 minify（esbuild 星面码点 bug）
- 冲突：生产构建默认 minify，但 esbuild 压缩时会把 `he` 包里 `'\uD835\uDD5E'` 转义属性键输出成裸星面标识符（𝕞），这不是合法 ES 标识符，浏览器加载 plugin-sandbox.js 直接 SyntaxError；Node 单测只测源码模块、从不执行构建产物，拦不住。
- 选择：vite.sandbox.config.ts 固定 `minify: false`（426KB 原始 / 98KB gzip，体积可接受），构建后脚本另有 `new Function(source)` 语法自检兜底。
- 原因：换库或升级 esbuild 都不如关掉压缩确定；沙箱产物是固定单文件、gzip 后体积差异很小。
- 影响：frontend/vite.sandbox.config.ts 一处；后续若 esbuild 修复该 bug 可再评估打开。

## 2026-09-02 · 阶段 1.6 · 沙箱 blob 必须显式 charset=utf-8（中文乱码）
- 冲突：插件返回的歌单名在页面上是「Mock ç§è—」式 mojibake（UTF-8 字节被按 windows-1252 解码），而存储、传输、安装链路各环节逐一验证都是干净的。
- 选择：沙箱文档 blob 与插件脚本 blob 的 MIME 都带 `charset=utf-8`，文档内再加 `<meta charset>`；PROTOCOL §8 已回填为协议要求。
- 原因：opaque-origin 的 blob 文档不继承父页编码，按编码嗅探算法回落 windows-1252；无 charset 的经典外部脚本按所在文档的编码解码——插件代码里的中文字面量在执行那一刻就错了，与 RPC/存储无关。
- 影响：sandboxDocument.ts + runtime.ts browserCodeLoader 两处；PROTOCOL §8 补了一句。

## 2026-09-02 · 阶段 2.3 · 跨源推荐/电台的两处收敛
- 冲突：PLAN §4.5 说推荐与电台候选「对所有声明 radio 能力的音源各拉一份」，但定向候选（偏好歌手/歌曲 id）的 id 是源内标识，跨源不可迁移；按名字跨源猜需要名字→id 解析通道，阶段 2 没有这条通道。
- 选择：外源只走探索通道（getRandomSongs / getStarred），定向三通道仍主库；电台起播按种子所属源路由适配器，续播补给暂限种子源内。
- 原因：错配的定向候选比没有更糟（外源拿主库 id 查询只会 404 或错曲）；探索通道已满足「候选跨源混排」的产品意图。
- 影响：usePersonalizedRecommendations / services/radio.ts；名字→id 解析通道（搜索先行）留到阶段 3 与真实插件联调时补。

## 2026-09-02 · 阶段 2.5 · 队列内换源顺延
- 冲突：PLAN 2.5 说多来源曲目可长按或点徽标切换来源；队列/播放页的曲目是普通 Song，match.ts 的备选（同曲各源版本）没有随队列入队的数据通道。
- 选择：v1 在搜索「全部」视图的曲目行做换源（行内换代表曲目，再播放即用新源）；队列内换源顺延。
- 原因：队列存的是扁平 Song 数组，塞备选需要改 playerStore 的队列形状与持久化格式，影响面远超阶段 2 收益；搜索视图已覆盖「切来源再播」的主路径。
- 影响：SongList 的 getAlternates/onReplace 只在搜索页接线；阶段 3 联调时再评估队列通道。

## 2026-09-02 · 阶段 3 · 网易云插件单文件交付（无 lib/）
- 冲突：PLAN §4.2 提到 plugins/netease/（+ lib/crypto.js），但阶段 1 的沙箱 CommonJS 加载器只认具名模块（axios/crypto-js/dayjs/qs/he/big-integer），不支持插件内相对 require。
- 选择：crypto 与请求封装全部内联进 index.js 单文件；`_crypto` 命名空间导出给测试用。
- 原因：给加载器加相对路径解析要动沙箱运行时与安装校验（多文件代码哈希、入口解析），影响面大于收益；单文件与 Node 测试骨架也天然兼容。
- 影响：plugins/netease/index.js；将来加载器支持多文件时再拆 lib/。

## 2026-09-03 · 验收反馈 · 内置音源自动安装（N1KO 产品要求）
- 冲突：PLAN §2.2 说插件经「添加插件」手动安装；N1KO 体验后要求网易云 / QQ 首启即用，且目录里不要出现 Mock。
- 选择：pluginStore.load 首次加载时（插件列表为空且未种过）自动从目录安装 netease + qqmusic（meta 标记 builtin-seeded，卸载不复活）；plugins/catalog.json 移除 mock 条目（插件本体与测试保留，开发/CI 用 URL 安装）。
- 原因：两大官方音源是产品主路径，不该藏在安装流程后面；Mock 是开发夹具不该给最终用户看。
- 影响：pluginStore.ts seedBuiltins、plugins/catalog.json；正式版默认目录为空 → 种子静默跳过（正式分发方案发布流程再定）。

## 2026-09-03 · 验收反馈 · 开发代理 manual redirect 改用 Node 原生 http
- 冲突：阶段 4 把 redirect:'manual' 交给 fetch 处理，但 undici 实现 Fetch 规范——manual 返回 opaque-redirect（状态 0、头部全空），QQ check_sig 拿不到 p_skey（N1KO 实测报「QQ 授权失败」）。
- 选择：开发代理对 manual 请求走 node:http/https 原生请求（Node 核心默认不跟随 3xx，状态与 set-cookie/Location 完整可读）。
- 原因：规范行为与需求冲突时，换实现比绕规范稳。
- 影响：vite.config.ts nodeRequestNoRedirect；CapacitorHttp 通道仍不支持 manual（QQ 扫码在真机的可用性待真机验证）。

## 2026-09-03 · 验收反馈 · 内置音源自动更新（设置页在登录墙后）
- 冲突：插件更新入口在设置 → 音源，但设置页在 RequireAuth 后面——首启未连任何音乐服务器时（正是登录 QQ 的场景）用户进不去，被要求「先更新插件」死锁。
- 选择：load() 时对内置音源（netease/qqmusic）静默自动更新：目录版本 ≠ 已装版本且 hosts 无新增（有新增留给手动更新走确认，PROTOCOL §9）。
- 原因：官方一等音源是产品主路径，更新不该是用户任务。
- 影响：pluginStore.ts autoUpdateBuiltins。

## 2026-09-03 · 验收反馈 · 多源推荐合并进首页（今日推荐）
- 冲突：各源的每日推荐（网易云「每日推荐」、QQ「雷达推荐」）原先只能藏在各自榜单分组里逐个点开，N1KO 要求「多音源如何合并下推荐」。
- 选择：协议新增可选方法 `n1ko.user.getRecommendSongs()` 与能力 `recommendSongs`；首页新增「今日推荐」合并区——各源轮转交错 + 标题/歌手归一去重（上限 20），推荐歌单横栏同样合并成一张交错网格（卡片带音源标识）。榜单保持各源分组（榜单本质是平台各自的）。
- 原因：合并区把「今天听什么」变成一个入口；交错而非拼接保证单一音源不刷屏；未登录的源查询失败降级为不出场，不拖垮整页。
- 影响：plugins/netease 0.1.6、plugins/qqmusic 0.1.4（fetchDailyRecommend / fetchRadarSongs 抽出复用）；plugin.ts 挂 getRecommendSongs；useSourceQueries.interleaveRecommendations（纯函数有单测）。

## 2026-09-03 · 验收第三轮 · QQ 非歌曲搜索的诚实降级
- 冲突：do_search_v2 的 search_type 此前硬编码 100，歌单/专辑/歌手搜索全按歌查；改为按类型映射（100/10/200/3000）后，实测匿名态新版响应里非歌曲分节（item_songlist/singer/item_album）依旧为空——QQ 侧歌单广场、soso 老 CGI、PlayListPlazaServer 全部 500003 或空（IP 区域限制，与当初搜索被封同源）。
- 选择：保留类型映射（方向正确、登录态下才可能点亮、对歌曲搜索零影响），QQ 匿名不向「推荐歌单」合并区贡献内容，网格由网易云撑起；不做假数据。
- 影响：plugins/qqmusic 0.1.6；等有登录凭据或端点恢复后再实测点亮。

## 2026-09-05 · 发版前收口 · 正式版出厂插件目录随包打进 dist
- 冲突：此前正式版 `defaultCatalogUrl()` 为空串——装好的 App 一个音源都没有，只能自己去设置里填地址；「没有 NAS 的人也能用」在正式版上等于没实现。先考虑过指向本仓库版本标签的 GitHub raw 地址，但国内网络对 raw.githubusercontent.com 时通时不通，首启种子只跑一次，拉不到就等于永远没有音源。
- 选择：正式构建把 `plugins/catalog.json` 及目录里列出的插件（manifest + 代码）原样打进 `dist/plugins/`（vite.config.ts `n1koBundlePlugins`，缺文件即构建失败）；出厂目录 = 同源的 `/plugins/catalog.json`。`VITE_PLUGIN_CATALOG_URL` 可整体覆盖（自托管用）。「内置」判定改为按出厂目录**所在目录树**的前缀（而不是 origin——Tauri / Capacitor 的自定义 scheme 下 origin 序列化为 "null"，raw.githubusercontent.com 那种 origin 下又住着所有人的仓库）；安装地址的同源放行同样改为按 protocol + host 比。
- 原因：离线可用、与 App 版本严格一致、不引入一个能远程换代码的地址；插件升级随 App 发版，版本号变了就走既有的内置静默更新（hosts 有新增仍扣下等确认）。
- 影响：vite.config.ts、pluginStore.ts defaultCatalogUrl/isFactoryUrl、catalog.ts assertSafeInstallUrl；新增 catalog.test.ts 与 pluginStore 两段式安装 / 出厂判定用例。Mock 不在目录里，自然不进包。

## 2026-09-05 · 发版前收口 · 插件返回的地址同样过白名单
- 冲突：`hosts` 只管沙箱**发出**的请求；插件**返回**的封面 / 流地址 / 二维码图原样进了 `<img>` 与 `<audio>`——`javascript:`、`file:`、拼了凭据的第三方地址都能进界面。
- 选择：封面、头像、歌单封面只认 `hosts` 内的 http(s)，另放行 8 KB 以内的内联 `data:image`（离线 Mock 的占位 SVG）；流地址与二维码图额外放行 `data:audio|video|image`；不通过的封面即空（走占位图），不通过的流地址即 `forbidden`。
- 原因：封面会随歌曲落进听歌历史，几 MB 的 data: 串能把存储撑爆，所以封面这一档不能全放；几 KB 的上限装得下占位图、装不下真照片。
- 影响：whitelist.ts safeResourceUrl、mapping.ts safeArtwork、plugin.ts resolveStreamUrl/getCoverUrl、QrLogin.tsx。

## 2026-09-05 · 发版前收口 · 重定向逐跳复检、沙箱越界即停用、开发代理不再盲信请求体
- 冲突：四条网络通道都让底层自动跟随 3xx，白名单只在第一跳生效；沙箱若自导航到别处宿主毫无察觉；开发代理的白名单来自请求体、任何同机页面都能借它出网。
- 选择：通道一律不跟随，宿主自己最多跟 5 跳、每跳复检白名单与私网、跨主机剥 Cookie/Authorization；父文档 CSP `frame-src blob:` + `ready` 后二次 `load` 即 dispose 并把音源标为「插件异常，已停用」；开发代理按 pluginId 读盘取白名单，强制同源 + 自定义头 + JSON，DNS 解到私网即拒。
- 原因：白名单是这套插件体系唯一的出网边界，任何一处绕过都等于没有边界。
- 影响：hostFetch.ts followRedirects、vite.config.ts proxyRequestGuard/pluginHostsFromDisk、PluginHost.ts markCompromised、index.html CSP；浏览器正式版通道对跨源 3xx 会拿到 opaqueredirect（本就因 CORS 走不通插件音源，无实际损失）。

## 2026-09-05 · 发版前收口 · 软陶皮肤的杂志语汇
- 冲突：`专辑 · ALBUM`、`TRACKS`、`VOL.3 NO.36` 这类双语报头的拉丁半边在编辑风与波普里是排印语汇，在软陶（仪表盘）里读作没翻译的碎片。
- 选择：眉批的拉丁半边拆成独立 `.latin-tag` 节点（i18n 只留中文/英文半边），软陶与非中文界面下由既有 CSS 规则收掉；`.sticker` 保留（内容是正常文案）。
- 影响：AlbumDetail / ArtistDetail / SongDetail 眉批与专辑页 tab；两份 i18n 的三个 eyebrow 值。
