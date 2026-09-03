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
