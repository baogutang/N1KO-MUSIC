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

## 2026-09-06 · 线上事故 · 桌面通道与开发代理必须发一样的请求
- 冲突：插件登录只在开发态（浏览器 + Vite 的 Node 代理）验证过；v1.11.1 装到桌面上 QQ 扫码报「没有 p_skey」、网易云登录后所有已授权接口失败（横幅一直说登录失效、曲库那节「此音源加载失败」）。
- 原因（在真实 Tauri 壳里逐条实测）：`tauri-plugin-http` 与 Node 代理有三处不一样——
  1. 它**不认** fetch 的 `redirect: 'manual'`（只读自己的 `maxRedirections`），reqwest 默认跟随 10 跳，QQ 要读的 check_sig 那一跳 302 的 `set-cookie` 被跟掉了；
  2. 它给每个请求补 `Origin: tauri://localhost`（Node 代理不带任何 Origin），网易云 weapi 对 Origin 敏感；
  3. 插件没设 UA 时它补 `tauri-plugin-http/2.6.0`（QQ 的 check_sig 恰好没设），等于自报是机器人。
- 选择：通道传 `maxRedirections: 0`；插件没写 Origin 时送空串（crate 见空 Origin 会整个删掉，这是它留的显式出口）；沙箱 axios 在插件没写 UA 时补一个普通桌面 Chrome 的 UA。三条都有单测钉住。
- 实测方式：临时诊断模块在 `tauri dev` 壳里经 `hostFetch` 打 httpbin 与网易云，把服务端看到的请求头回传到本地日志端口。修复后：无 Origin、`redirect:'manual'` 拿到 302 + Location、UA 是浏览器 UA。
- 教训：「在开发态验证过」不等于「在用户装的壳里验证过」。凡是宿主替插件发请求的通道，都要按「服务端看到了什么」对齐，而不是按调用方写了什么。

## 2026-09-06 · 线上事故（真凶）· 多条 set-cookie 只留下了最后一条
- 冲突：v1.11.2 修完 Origin / 重定向 / UA 之后，桌面版 QQ 仍报「没有 p_skey」、网易云登录后接口依旧全挂。
- 原因：`normalizeFetchResponse` 里 `res.headers.forEach((v,k) => headers[k] = v)`。**set-cookie 在 Headers 迭代里是逐条产出的**（规范对它的特例：其它多值头会被合并成一条，只有它每条单独给），于是每来一条覆盖上一条，最后只剩最后一条。QQ 的 check_sig 下发 p_skey / p_uin / pt4_token 三条，p_skey 排在第一条 → 永远拿不到；网易云的 MUSIC_U 同理，凭据是残的，所以「登录成功了但所有要授权的接口都不认账」。
- 选择：同名头按 fetch 的合并形态拼接（`a, b`），并在引擎支持时用 `getSetCookie()` 取权威的逐条值。插件侧的 `parseSetCookie` 本来就认这个形状（它的正则能躲开 `Expires=Thu, 01 Jan ...` 里的逗号）。
- 实测（真实 Tauri 壳，httpbin 下发三条 Set-Cookie）：`forEach` 产出 3 条、旧写法只剩 `pt4_token`、`getSetCookie()` 可用且返回全部三条、修复后三条齐全。
- 教训：前两版都是「看代码推理出一个合理原因就发版」。这一版是先在壳里把**旧行为与新行为同时打印出来**再发。修网络层这种跨实现的东西，没有前后对比就不算定位。

## 2026-09-07 · 壳是安全上下文，插件给的 http 地址全部拦掉
- 冲突：登录通了之后，桌面版网易云歌单封面全是裂图、QQ 点播报「Stream URL not in plugin allowlist」。
- 原因：`tauri://localhost` 与 `capacitor://localhost` 都是**安全上下文**，`http://` 的图片与音频算混合内容被直接拦（开发态页面本身是 http，所以看不出来）。网易云返回的封面就是 `http://p1.music.126.net/...`；QQ 的取流地址来自服务端 CDN 派发（`cdnDispatch` 的 sip），域名随机（ws6/isure6…）且可能是 http，manifest 里只写了三个固定域名。
- 选择：宿主在**映射层**就把插件给的封面升到 https（`httpsUpgrade`），`getCoverUrl` / `resolveStreamUrl` 再各兜一道（落盘的旧数据也要救）；QQ manifest 放宽到 `*.stream.qqmusic.qq.com`，插件侧 `safeSip` 只接受这个范围内的派发结果并强制 https，不合规就退回固定域名；白名单拒绝时的报错带上域名，否则没人查得下去。
- 影响：plugins/qqmusic 0.1.10。

## 2026-09-07 · 跨源降级的乒乓循环
- 冲突：一首放不了的歌会无限地 QQ→网易云→QQ 换来换去，每轮弹两条提示，看上去就是「报错框永远不消失」。
- 原因：守卫记的是「加载 key」，而 key 里带着 serverId——换源之后 key 就变了，等于没有守卫。
- 选择：按**队列位置**记一条换源链，把试过的源攒进 Set，每个源在一首歌上只试一次；放成了就作废这条链（重听同一首可以重新走）。顺带把提示顺序倒过来：先找替代源，找到就只说一句「已切换到 X 继续播放」，只有所有源都试过才报一次错——成功的降级不该弹一条刺眼的红。

## 2026-09-07 · VIP 曲目的三个问题（用户提的）
- 标识看不见：VIP 徽标用了 `.latin-tag`，而那个类是「双语报头的拉丁半边」，软陶皮肤与非中文界面下 `display:none`。状态标记不能用排印装饰类——这是第二次踩（第一次是设置页的类型徽标）。
- 账号权益不知道：`n1ko.auth.getUser` 本来就返回 `vip`，但没人存。现在连上后回填到 `ServerConfig.accountVip`。
- 推荐该不该推：确知没有会员时（`accountVip === false`）把会员曲从**合并推荐**里滤掉——推荐位是「现在放什么」，推一首点下去只会报「试听片段不提供播放」的曲子是在浪费这个位置。搜索与曲库照旧可见，只是不主动推；账号信息还没问到（undefined）时什么都不做，宁可多推不要少推。

## 2026-09-07 · QQ 昵称与雷达推荐（用户提的两个「为什么」）
- 昵称：登录响应里那几个字段名（nick / nickname / user_nick）是按常见名猜的，QQ 实际不给——账号列表永远写着占位的「QQ 音乐用户」，而网易云那边有真昵称，对比之下像是坏了。改成 getUser 时再从主页接口与歌单响应里捞一次，都捞不到才用占位名；主页接口顺带把会员标记也带回来（喂给 accountVip）。
- 雷达推荐不出现：`fetchRadarSongs` 读的是写死的 `radar.tracks`。QQ 各接口装歌曲列表的键名并不统一而且会变，读错就是**静默为空**——界面上就是「今天听什么」里没有 QQ，既不报错也没线索。改成先认一批已知键、再按形状找（元素带 mid 的数组），**找不到就明确报错并把响应的顶层字段名带出来**：真没有数据和键名又改了是两回事，后者必须说出来。
- 教训：跨平台逆向接口里，「读一个写死的键名」等于赌，赌输了还是静默的。要么按形状找，要么在读不到时大声说。

## 2026-09-07 · 随包目录的 hosts 扩容不再要二次确认
- 冲突：v1.11.4 给 QQ 插件加了取流域名，而「hosts 有新增就扣下等确认」把更新拦在设置页——用户装完新版发现 QQ 还是放不了，且完全不知道要去哪确认。
- 选择：随包目录（同源 `/plugins/catalog.json`，非 DEV、无 `VITE_PLUGIN_CATALOG_URL` 覆盖）的 hosts 扩容直接生效。那份目录在安装包里、与 App 一起分发，用户装这个版本时就已经同意了这份 hosts。自托管覆盖与任何远端目录仍然要确认——那才是这道闸门真正要防的东西。

## 2026-09-07 · 外部审阅（Codex/astra）复核与修复 · F01–F05、F16
外部审阅带隔离探针，13 项在当时代码上全部复现。逐项对代码核实后，F01–F05、F16 均成立；F03 是 v1.11.5 引入的回归。

- **F01 切歌竞态**：`doLoad` 的失败分支从头到尾没有作废检查（成功分支有）。慢慢失败的 A 在用户已改点 B 之后回来，照样弹提示、换源、把 B 换成「A 的替代版本」。加 `stillCurrent()`（加载序号 + serverId + songId），失败入口、换源查询返回后、自动跳歌的定时器各查一次。身份必须带来源：同一首歌在两个音源下 id 可能相同。
- **F02 断源写错服务器**：`findAdapterFor(id) ?? getAdapter()` 在源断开时回落主库，把外源条目 id 发给主库。新增 `adapterForSource(serverId)`：没指定来源才回落主库，指定了却没连就抛可读错误。三处调用点（歌词 / 评分 / 收藏）统一。
- **F03 雷达把歌手当歌曲**（本次回归）：v1.11.5 为了躲开「写死键名」改成按形状递归找数组，而歌手条目也带 `mid`，于是 `tracks[].track_info.singer[]` 被当成歌曲，推荐里出现一位歌手名、0:00、点了没声。改为**显式拆包装层**（track_info/songInfo/musicData）+ 歌曲形状校验（要有标题且有时长/文件/专辑），只在顶层与 data 两层找，不递归全树。教训：躲开「写死键名」的正确做法是显式拆已知结构，不是让机器猜。
- **F04 更新不生效**：`ensurePluginHost` 只按凭据复用沙箱，更新后跑的还是旧代码；且 `pluginStore.load()` 只有登录页/设置页调，已登录用户整个会话不检查更新。沙箱身份加入代码哈希；rehydrate 里在连接之前 `await load()`。
- **F05 推荐过滤绕路**：屏蔽/会员权益的过滤只挂在部分分支上——持久化缓存不过滤、外源候选不过滤、平台每日推荐不过屏蔽。收敛成一处 `recommendationFilters`：现算、缓存、平台每日推荐三条入口共用同一道硬约束。权限未知（accountVip undefined）一律保留，不凭猜测扣掉。
- **F16 first-user 并发**：资格检查在 `await bcrypt.hash` 之前，写入时不复核，两个并发请求都拿到 201。改为在 better-sqlite3 的同步写事务里复核名额（拿写锁，多进程同样成立），实测 [201, 403] / 库内 1 个账号。

未修（本轮排期在后）：F06 种子丢来源、F07 首页与推荐页不同批、F08 Live 版被当重复、F09 榜单分页与入口、F10 收藏入口不一致、F11 歌词解析、F12 失败可见性、F13 搜索串行、F14 音质降级、F15 统计口径、F17 全屏可访问性、F18 CI 门禁。

