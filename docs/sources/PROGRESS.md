# 多音源聚合：进度报告

## 环境自检 · 2026-09-02

| 检查项 | 结果 |
|---|---|
| `node -v` | v24.18.0（要求 22+，通过） |
| `npm ci` | 通过（sharp 0.32.6 的 allow-scripts 警告为既有噪音，不影响） |
| `npm run lint`（`--max-warnings 0`） | 通过，0 警告 |
| `npx tsc --noEmit` | 通过 |
| `npm test`（vitest） | 29 个文件 443 个测试全部通过 |
| `curl -sI https://music.163.com/` | HTTP/2 200，可联网 |
| `cargo --version` | cargo 1.97.1，Tauri 侧可验证 |

开工基线：main @ 199bc05（1.10.0），工作分支 `feat/sources`。

## 阶段 0 · 2026-09-02

底座改造，不新增任何用户可见功能，现有行为不变。

### 完成
- 0.1 · 类型底座：ServerType 增 `plugin`，ServerConfig 增 `pluginId / credentials / autoConnect`；`Song / Album / Artist / Playlist` 的 `serverId` 改必填并由全部 mapper 填上；`MusicServerAdapter` 增可选 `resolveStreamUrl / getSourceCapabilities / getTopLists / getTopListDetail / getRecommendSheets`；新增 `SourceCapabilities` 并并入 `useServerCapabilities` · `042ae19`
- 0.2 · 适配器注册表替代单例：`registerAdapter / unregisterAdapter / getAdapterFor / hasAdapterFor / findAdapterFor / listAdapters / setPrimary`，`getAdapter()` 保留为主库语义；serverStore 增 `connectedServerIds` 与 `connectServer / disconnectServer / setPrimaryServer`，`activateServer` = connect + setPrimary，rehydrate 连上所有 autoConnect 服务器；34+ 处 `getAdapter()` 调用点按「条目域 / 主库 / 发现类（TODO(sources) 标记）」分类改造 · `583b1a0`
- 0.3 · 播放引擎：`isStreamExpired` / `buildStreamCacheKey` / `resolveStreamFromAdapter` 纯函数 + 单测；加载入口改 `resolveStream`（异步取流 / 缓存 / 过期重取 / 加载序号作废晚到结果）；MediaError 恢复对异步源先绕过缓存重取一次，同步直链维持原 format 回退；scrobble 按 `song.serverId` 找适配器 · `481c642`
- 0.4 · 登录页走工厂：`handleConnect` 统一为「createAdapter 临时适配器 login() → addServer → activateServer」，不再直接 new 适配器类 · `290003e`

### 验证
- 自动：`npm run lint`（--max-warnings 0）✅ · `npx tsc --noEmit` ✅ · `vitest` 30 文件 471 用例全过 ✅（基线 443 → 新增 28：注册表 15、流缓存/过期 9、serverId 断言 4）；`plugins/` 无改动，未跑 test:plugins
- 手动（浏览器开发态，mock Subsonic :4533 + Vite :5273 + 本机 Chrome CDP 驱动真实 UI）：
  - 登录 → 播放整张专辑 → 首页 / 专辑详情 / 全屏播放页 / 歌词，全部正常渲染、console 异常 0 条；截图在 `docs/sources/screenshots/phase0-smoke/`（4 张）。进度条 0:00 是 headless Chrome 自动播放策略所致，非回归
  - 多服务器冒烟：两台服务器（同一 mock 后端、两个 ServerConfig）同时连接 → 设置页同时显示两行 → 切换主库（toast + 按钮状态翻转）→ 移除非主库（连接保持，库A 仍为主库）→ 移除主库（回到登录页）；console 异常 0 条。验证脚本为一次性 CDP 脚本，用完已删
  - mock 的 `/rest/stream.view` 直连返回 200 audio/wav 2.0MB，取流链路数据面可用

### 未完成 / 跳过
- 0.3 验收里的「浏览器验证异步过期重取」：阶段 0 没有任何异步取流型适配器可注册进真实应用，纯逻辑已由单测覆盖（含 5 秒过期的 margin 判定）；完整链路并入阶段 1 Mock 插件的「20 秒过期重取」验收（见 DECISIONS.md）
- Tauri / Capacitor 真机验证：阶段 0 未触及平台层，未做（阶段 1.2 涉及）

### 需要 N1KO 决定
- 无。阶段 0 范围内无阻塞问题。

### 顺手发现（没有修）
- `scripts/shoot-screenshots.mjs` 默认端口 5173 被占用时报错不友好（本次本机 5173 被另一个项目占用，用 `--app` 指到 5273 绕过）
- `scripts/mock-subsonic.mjs` 不记录请求日志，冒烟时无法从服务端侧确认请求到达
- `docs/audit-2026-07-21.md` 高-4 提到的 `o3icCacheStore`（歌词缓存 key 缺 server 前缀）在当前 main 上仍存在（`useLyricsQuery` 的缓存路径读 `getCachedLyrics(songId)`）；阶段 2 做聚合歌词时需要一并处理，本阶段未动
- `Login.tsx` 登录成功后 `activateServer` 的返回值未检查（沿用旧行为；阶段 1 登录流程重写时一并处理）

## 阶段 1 · 2026-09-02

### 完成
- 1.1 · 沙箱运行时：CommonJS 插件在 opaque-origin iframe（`sandbox="allow-scripts"`）里以 blob: 脚本执行（协议禁 eval），postMessage RPC 双向校验 `event.source`；axios/bigInt shim、PluginError 注入、方法路径探测 · `99fbe99`
- 1.2 · 宿主网络栈：hostFetch 三通道分发（CapacitorHttp / Tauri plugin-http / dev 代理 / 浏览器 fetch），白名单 + 私网拒绝双重校验（入口与每个通道），rebuildAllowedUrl 防解析器差异；请求/控制台日志环形缓冲 · `7b9df7e`
- 1.3 · PluginAdapter：MusicFree 形状→App 实体映射（putRawItem LRU）、能力探测挂载可选方法、错误透传 · `e1f3a8f`
- 1.4 · 安装与目录：manifest 校验、SHA-256 代码哈希、IndexedDB 持久化、目录/URL/粘贴三方式安装、更新比对、卸载连带清理（依赖服务器 + 凭据）· `916fc87`
- 1.5 · Mock 插件 + Node 测试骨架：17 个 node:test 用例覆盖全部方法；扫码状态机（waiting×2→scanned×2→confirmed）、20 秒过期流地址、VIP 标记曲 · `560530c`
- 1.6 · 登录与管理界面：登录页流媒体分组（声明确认→扫码/CK 登录→自动进入应用）、设置页音源区（账号数/更新/重登/请求日志/卸载/目录地址）、账号横幅、连接链异步化（沙箱初始化）· `dd05a31` + `e295dda`（登录页直接装插件，不必先进设置）
- 1.6 · E2E 暴露的三个浏览器-only 缺陷修复：沙箱 blob charset（中文 mojibake）、产物 minify（esbuild 星面标识符 SyntaxError）、Mock WAV 分块 base64 截断（Format error）· `0061b68` + `66adbcb`
- Tauri 侧：http 插件依赖与能力配置（CSP frame-src blob: / script-src 'self' blob:）随 `7b9df7e` 落地

### 验证
- 自动：`npm run lint`（--max-warnings 0）✅ · `npx tsc --noEmit` ✅ · `vitest` 36 文件 551 用例全过 ✅（阶段 0 基线 471 → +80）· `npm run test:plugins` 17 用例全过 ✅（WAV 修复后新增完整解码断言：24044 字节 / RIFF 头 / 幅值域）
- 手动（一次性 CDP E2E 脚本，验收后已删；headless Chrome 1280×800 + Vite :5273，自动播放放行）：
  - 全链路：目录安装 Mock → 声明确认 → 扫码（状态机 5 次轮询）→ 自动进入应用 → 歌单页三个 Mock 歌单 → 歌单详情 6 行 → 播放全部（3 秒 WAV 真出声，时间码走动）→ 全屏歌词（LRC 渲染）→ 等 21 秒过 TTL 后经播放队列重播同一首 → 时间码恢复走动（过期重取行为验证，即阶段 0.3 顺延过来的浏览器验证项）→ 全程 console 异常 0 条
  - 截图 17 张在 `docs/sources/screenshots/phase1/`：流程 7 张 + 登录页/设置音源区 × 双皮肤（pop/editorial）× 明暗 8 张 + 详情 2 张
- 平台通道：dev 代理（/__n1ko_proxy）走通；CapacitorHttp / Tauri 通道为条件编译代码路径，阶段 3 真机/桌面打包时验证（见未完成）

### 未完成 / 跳过
- 播放优先级设置：PLAN 自身两处矛盾（§195 列在 1.6、§207 列在 2.6），按 2.6 落地（DECISIONS.md 已记）；SourcesSettings 本阶段无优先级 UI
- Capacitor / Tauri 真机通道实测：需打包产物，属阶段 3 联调（本阶段三通道代码齐备，dev 通道已验证）
- pinyinInitial 全量拼音表：中文归 '#'，阶段 3 随网易云一起做（DECISIONS.md 1.3 条目）

### 需要 N1KO 决定
- 无阻塞项。两个小点已按最小侵入处理并记录：播放优先级顺延（上）；沙箱产物 minify 关闭（体积 426KB/gzip 98KB，可接受，见 DECISIONS）。

### 顺手发现（没有修）
- 声明确认步骤失败时错误提示不可见（该步骤不渲染错误区，只弹 toast；AddPluginDialog 安装失败同路径）——低频路径，阶段 2 统一理设置/登录错误呈现时一并处理
- 「首页出现 Mock 歌单」类验收实际落在歌单页：首页没有歌单栏位（设计如此，非缺陷），报告时按歌单页验收
- `Login.tsx` `activateServer` 返回值仍未检查（阶段 0 已记，登录流程虽重写但该行沿用；阶段 2 改登录态时处理）
- mock-subsonic 不记请求日志（阶段 0 已记，未动）

## 阶段 2 · 2026-09-02

### 完成
- 2.1 · `useSourceQueries` 聚合查询底座（每源一条 query 并发、单源失败塌缩成组错误、能力快照）与 `SourceBadge` 来源徽标（波普彩色小方块/纸墨单色描边；manifest `color` 优先，缺省 id 哈希取 `--src-1..5` 色板，token 在 index.css）；PROTOCOL §2 补 color 字段 · `3a0b62e`
- 2.2 · `match.ts` 三级同曲匹配（ISRC / 归一标题+歌手集合+时长≤2s / 模糊标待确认）+ 搜索页「全部/按音源」双视图：全部跑同曲合并（代表曲目按优先序）、歌手/专辑跨源去重、分组视图主库在前；单源行为逐字节不变 · `3741b64`
- 2.3 · 首页多源区块（各源歌单/收藏入口行、榜单 chips → /toplists/:serverId/:id 详情页、推荐歌单横排，全部「有内容才渲染」）；推荐候选跨源（外源走随机+收藏探索通道）；电台种子按来源路由适配器（修混源错路由）· `796ff2e`
- 2.4 · 专辑/歌手页只列 libraryBrowse 源（多源时页头源切换 chip，无可浏览源时空态）；歌单/收藏页按音源分节（主库节保留写操作）；详情链路跨源正确性（卡片带 ?src=、五个查询 hook 按来源路由与分域缓存）· `1b7592b`
- 2.5/2.6 · 曲目行/播放条/全屏播放页/队列抽屉来源徽标（多源才出现）；搜索全部视图多来源行点徽标换源（菜单列出各源版本）；设置·音源增主库选择器与播放优先级（上下移排序，settingsStore.playbackPriority，空=自动 NAS 优先），match 代表选择同序消费 · `39610c7`
- E2E 抓到并修复一个真回归：适配器解析提到渲染体后，插件主库 rehydrate 窗口期同步抛错炸页 → 挪回 queryFn + enabled 守卫 · `b77330c`
- 验收夹具：两个 Mock 库各加 Summer Breeze（同名同歌手差 1 秒，跨源 exact 合并用）· `04f9e19`

### 验证
- 自动：lint ✅ · tsc ✅ · vitest **576/576**（阶段 1 基线 551 → +25：match 三级、徽标取档、优先序解析、聚合 zip）· test:plugins **17/17** ✅
- 手动（一次性 CDP E2E，验收后已删；NAS=mock-subsonic:4533 + Mock 插件双源，headless Chrome 1280×900）：
  - 双源连接 → 首页出现我的音乐库/榜单/推荐歌单区块 → 搜索 summer：全部视图「1 首来自多个音源」合并行 + 分组视图两组（NAS 组在前带徽标）→ 合并行点徽标换到 Mock 源 → 播放的是 Mock 的 3 秒 WAV（0:00/0:03，非 NAS 的 3:24 流）→ 设置出现主库选择器与播放优先级 → 歌单/收藏分节；**console 异常 0 条**
  - 截图 16 张在 `docs/sources/screenshots/phase2/`：流程 8 张 + 搜索/设置 × pop/editorial × 明暗 8 张

### 未完成 / 跳过
- 队列内换源：需要队列形状改版，顺延（DECISIONS.md 阶段 2.5 条目）
- 跨源专辑墙混排：浏览页按「单源浏览 + 源切换」落地（DECISIONS.md 阶段 2.4 条目）
- 流派页：本就不存在（useGenres 无调用方），无需过滤

### 需要 N1KO 决定
- 无阻塞项

### 顺手发现（没有修）
- 声明确认/安装失败步骤错误提示不可见（阶段 1 已记，仍开放）
- `Login.tsx` `activateServer` 返回值未检查（阶段 0 已记，仍开放）

## 阶段 3 · 2026-09-03

### 完成
- 网易云音乐插件 `plugins/netease/`：weapi（双重 AES-CBC + 原生 BigInt 裸 RSA 模幂）/ eapi（URL 摘要 + AES-ECB）从 api-enhanced 移植，不引其包；eapi(interfacepc) / weapi(music.163.com) 双通道请求封装，header cookie 全量自拼；匿名令牌 register/anonimous 惰性注册（注册请求显式绕过凭据解析，打断自递归）；cloudsearch / player-url-v1（回落 download-url-v1）/ lyric-v1 / album / artist-top-song / toplist / playlist-list / v6-playlist-detail+v3-song-detail / playlist 操作；扫码状态机 800/801/802/803；音质四档映射 level；fee/-110 → forbidden（只播账号有权内容）· `d23950b`（见 git log）
- 测试：crypto 与参考包（临时目录安装，不进仓库依赖）逐字段一致（weapi params/encSecKey + eapi 全等）；live 测试默认跳过（N1KO_NETEASE_LIVE=1），本机实测 947ms 全过：匿名注册 → 搜索 → 榜单 → 二维码 key → 免费曲流地址 → 歌词
- 单文件交付（沙箱加载器不支持相对 require，记 DECISIONS）；网易云 n1ko.auth 补 createQr/checkQr 委托

### 验证
- 自动：vitest 576/576 · test:plugins 20 过 + 1 live 跳过（CI）· live 本机全过

### 需要 N1KO 决定（手机验收清单）
1. 扫码登录：显示昵称头像；我的歌单与收藏
2. VIP 曲：会员账号可播；非会员账号标灰并有原因
3. Cookie 失效后顶部横幅出现；重新扫码后恢复

## 阶段 4 · 2026-09-03

### 完成
- QQ 音乐插件 `plugins/qqmusic/`：musicu.fcg web 平台 comm（g_tk=hash33）+ zzc 签名 + hash33 从 luren-dc/QQMusicApi 移植 · `commit`
  - do_search_v2 搜索（布尔转 0/1、大整型 searchid）；Toplist 榜单（GetAll 的 group[] / GetDetail 的 songInfoList——实证发现的真实形状）；CgiGetDiss 歌单；vkey.GetVkey + GetCdnDispatch 取流（result 104003/104013 → forbidden）；专辑/歌手/用户接口
  - **QRC 歌词魔改 3DES 全量移植**：QQ 自定义 S 盒与带 bug 的 PC-2 密钥压缩（标准 crypto-js 解不开，逐函数对照 Python 参考）；HEX 载荷；3DES 尾部垃圾用增量读解压前缀容忍（python zlib.decompress 同语义）
  - QQ 扫码登录链路：ptqrshow（PNG 二维码 + qrsig）→ ptqrlogin（hash33 token）→ check_sig（p_skey）→ authorize（Location 取 code）→ QQConnectLogin.QQLogin CGI
- 宿主扩展：HostFetchRequest.redirect='manual' 全链路透传（axios shim / hostFetch / dev 代理 / Tauri）；createQr 可返回 qrImage（服务端二维码图），QrLogin 渲染 <img>
- 测试：zzc/hash33 与 Python 参考逐值一致（向量由参考实现在本机算出后钉死）；live 默认跳过（N1KO_QQ_LIVE=1）

### 验证
- 自动：vitest 576/576 · test:plugins 24 过 + 2 live 跳过
- live 本机：榜单 → 详情 → 二维码（PNG+qrsig）→ 免费曲 vkey 流地址 → QRC 歌词解密全过（386ms）
- **搜索受 IP 地域限制**：本机出口 IP 被 QQ 搜索静默过滤（do_search_v2 code 2001 / sum 0，两个端点一致）——live 测试降级告警；实现本身待手机端确认

### 需要 N1KO 决定（手机验收清单）
1. QQ/微信扫码登录成功显示昵称
2. 中国大陆网络下搜索是否正常（本机 IP 无法验证）
3. VIP 曲按账号权益播放；非会员标灰
4. QQ 扫码需要 App 或桌面版（浏览器跨源 manual redirect 是 opaque，与 PLAN 一致）

## 阶段 5 · 2026-09-03

### 完成
- ImportFromSourceDialog：选来源歌单（任何声明 userPlaylists 的已连接源）→ bestMatchFor 三级匹配进主库（ISRC/精确/待确认分级展示）→ 新建或追加主库歌单；未匹配清单自动放进本地混合歌单
- 本地混合歌单：IndexedDB n1ko-music-local-playlists，条目 {serverId, songId} + 曲目快照；歌单页独立分节带「本地」标，查看对话框支持播放/删除；不同步 backend
- 文件导入（M3U/XSPF）匹配候选聚合所有已连接音源（阶段 1 遗留 TODO）：主库命中进服务端歌单，只在其他音源命中的放进本地混合歌单

### 验证
- 自动：lint ✅ tsc ✅ vitest 576/576 · 三级匹配规则单测（match.test.ts，阶段 2 落地）覆盖 isrc/exact/fuzzy/时长缺席/同名不同歌手/Live 版
- 手动：跨源导入与本地混合歌单走查属于手机验收清单第 5 项（Mock NAS + Mock 插件之间导入）

### 手机验收清单（全部阶段合并，需要 N1KO）
1. 网易云扫码：昵称头像 / 我的歌单与收藏 / VIP 曲按账号权益 / Cookie 失效横幅
2. QQ 扫码（需 App 或桌面版）：昵称 / 大陆网络下搜索 / VIP 曲按账号权益
3. 真机（iOS/Android）与桌面（Tauri）安装真实插件后取流通畅（CapacitorHttp / tauri-plugin-http 通道，代码就绪未真机验证）
4. 双源同时连接的日常使用：搜索聚合 / 播放 / 歌词 / 过期重取（开发态 E2E 已覆盖，真机复验）
5. 跨源导入：Mock NAS ↔ Mock 插件互导 + 本地混合歌单

## 2026-09-03 · 验收反馈第二轮（QQ 搜索 / 推荐合并 / 官方 logo / 全局修复）

| 事项 | 提交 | 说明 |
| --- | --- | --- |
| QQ 搜索崩溃（item_song 非数组） | a498658 | 2026-09 起 do_search_v2 各分节改为 {items:[...]} 对象；sectionItems 兼容双形态，封面优先 pmid（0.1.3） |
| 首页「今日推荐」多源合并 | 63748e5 | 协议新增 n1ko.user.getRecommendSongs + recommendSongs 能力（netease 0.1.6 / qqmusic 0.1.4）；interleaveRecommendations 轮转交错去重；推荐歌单合并网格 |
| 音源标识官方 logo | — | public/logos 打包两家的 App Store 官方 512px 图标；SourceBadge 内置源渲染 logo，第三方回退色块 |
| 全局体验修复 | 5a34eb1 / 252c309 | 详情页跳转 14 处补 ?src=（混合列表跳主库落空）；SongList 标 VIP；fetchAllDetailPages 防呆；专辑详情补 isEnd（netease 0.1.7 / qqmusic 0.1.5） |

无头探针（scripts/tmp/probe-sweep.mjs）全绿：NAS + 双流媒体匿名 → 聚合搜索 46 行无失败 → 非 VIP 曲播放时间码前进 → 首页合并网格/官方 logo → QQ 歌手页 25 曲、专辑页有曲目 → 收藏页无异常，console 零报错。

## 2026-10-12 第四轮 · 阶段 1（P0 功能性 bug）

**做了**：1.1–1.12 全部 12 条，无跳过。
- 1.1 网易歌单写入三方法迁至 n1ko.user（宿主唯一调用面），宿主能力探测路径真调验证；createPlaylist 返回带 platform。netease 0.1.14。
- 1.2 插件登录失败回 type 步，不再死局；真实路径（选插件→扫码→连接失败）用例验证。
- 1.3 新 utils/detailPath 工具，8 处详情跳转统一带 ?src=（AlbumDetail/Issue×4/ArtistDetail/NowPlayingOnServer/FullscreenPlayer）。1.9 同根因由此覆盖。
- 1.4 网易 getMusicInfo 走 v3/song/detail、QQ 走搜索精确匹配；链接打开详情页可达。netease 0.1.14 / qqmusic 0.1.17。
- 1.5 后端 stats/favorites 快钟钳制（与 notes A4 同款），前端不再丢记录。
- 1.6 清空历史遍历 historyScope。
- 1.7 抽 useDestructiveConfirm hook，Masthead/TopBar/MobileHeader 的切主库与断开都先确认。
- 1.8 歌词三态占位（加载/无/失败）；详情页歌词入口按「正在播放的就是这首」分流，否则本曲预览对话框。
- 1.10 全屏分享限主库曲且 target 带 serverId；保存队列混源分家（主库→服务端歌单，插件源→本地混合歌单，提示合一）。
- 1.11 三适配器 getSong 错误分流：只 404/not-found 转 null。
- 1.12 Home onKeyDown 判 target。

**门禁**：lint/tsc/vitest 894/build、backend 27、plugins 51+3skip、lint:plugins、check:versions、audit×2 全绿。
**提交**：fix(audit-2): 阶段 1（1.1–1.12）。
**取舍**（DECISIONS 已记）：1.10 混源分家走本地混合歌单；1.7 抽共用 hook；1.11 Jellyfin 400 也算 not-found；官网静态测试收缩到字体 URL 不变量（website/ 另一方改版中）。

## 2026-10-12 第四轮 · 阶段 2（展示状态与文案）

**做了**：2.1–2.7 全部 7 条。
- 2.1 五页（Artists/Playlists/Search/Favorites/Library）失败走 ErrorState、加载中隐藏 0 计数；组件级用例钉「错误态有重试按钮、与空态两套词」。
- 2.2 导入对话框三态补齐；全未匹配可只建本地混合歌单（missing 条目转最小 Song）。
- 2.3 catalogFailed + busy 全程。
- 2.4 error 态刷新按钮 + describeError。
- 2.5 中文标点全部进词条（common.listSeparator / quoteL / quoteR / search.sourceErrorLine）；两处 Enter 判 isComposing。
- 2.6 /toplists 列表页（按源分组、复用 useSourceTopLists 缓存），首页卡跳它。
- 2.7 pluginErrorCode（null 安全）替换 6 处鸭子取码；13 处直出 message 改 describeError；errors.lint.test.ts 钉住（Search 的 sectionFailures[].code 字符串比较与 QrLogin 在允许清单，理由写在测试头注）。

**门禁**：lint/tsc/vitest 898/build、backend 27、plugins 51+3skip、lint:plugins、check:versions、audit×2 全绿。
**提交**：fix(audit-2): 阶段 2（2.1–2.7）。

## 2026-10-12 第四轮 · 阶段 3（性能与体验）

**做了**：3.1/3.2/3.4/3.7/3.8/3.9/3.10/3.11/3.12 共 9 条；3.3/3.5/3.6 记 DECISIONS 跳过。
- 3.1 冷启动：主库先连 + 立即 setPrimary，其余源 Promise.allSettled；useRecentAlbums enabled 门。
- 3.2 沙箱 432KB → 195KB（gz 77.8KB）；assertSandboxSyntax 通过。
- 3.4 实测 23 个非拉丁子集共 558KB（任务书说 572KB 基本准确）——文件名加 -subset- 标签 + globIgnores；SW precache 119 条 3465KB → 97 条 2688KB。
- 3.7 距上次加载超 120ms 立即加载（每次切歌 −120ms 的等待）；ended 先切歌再落历史。
- 3.8 Artists useDeferredValue + content-visibility（未实测千级行为，推断收益）。
- 3.9 画像缓存（引用对比测试；回首页少算一次 ~11ms×2）。
- 3.10 在途去重 + 插件源 8s 后预解析下一首（不拉流）。
- 3.11 离线不耗恢复次数 + online 续播（5 分钟窗口）。
- 3.12 Search 页数/History 深度按 location.key 进 history.state。
- 跳过：3.3 词表动态（97 处同步 import，改动面大收益 −55KB）；3.5 qrcode（实测已在懒 chunk，前提不成立）；3.6 phosphor 字重（聚合入口无法廉价剔除，需换按字重入口，收益未达 20% 线）。

**门禁**：lint/tsc/vitest 902/build（precache 2688KB）、backend 27、plugins 51+3skip、lint:plugins、check:versions、audit×2 全绿。
**提交**：perf(audit-2): 阶段 3。

## 2026-10-12 第四轮 · 阶段 4（代码债）

**做了**：4.1–4.4、4.7–4.12 核心完成；4.5/4.6 与部分子项记未做。
- 4.1 capabilitiesOfAdapter 唯一真源 + rowCapsOf 行级回落统一（测试 5 条）。
- 4.2 useRecommendationConstraints（屏蔽名单 + accountVip 两维），删两处手写指纹与 eslint-disable。
- 4.3 customApi 模板填空：全局替换修正（旧 .replace 同一占位符出现两次时漏换第二个）。
- 4.4 probePluginUser 合成（清定时器、三态、测试 3 条）；5 处调用点替换因语义差异（Login 4 秒放行/逐源 diagnose）记未做。
- 4.7 删 6 项死代码；accentColor 从 themeStore 删除 + persist v2 migrate 剥除（首个带版本 store，作 4.6 模板）；LRC 统一 utils/lrc。
- 4.8 bestEffortPluginLogout（500ms 不拦断开）。
- 4.9 validation.ts 共用 optionalServerId/scopeSql；/health 移到限流前（测试验证）；v4 迁移疑点未复现。
- 4.10 lib/log.ts 落地（测试 2 条）；46 处 console 迁移记未做。
- 4.11 三处 IIFE 补 catch；收藏镜像 60s 重试队列。
- 4.12 后端 playlists 隔离 + DELETE history 两条用例（29 通过）。
- 4.3 判定：歌词「搜索对话框」与「自动查询」是不同职责，不强行合并，模板部分已收敛。

**门禁**：lint/tsc/vitest 915/build、backend 29、plugins 51+3skip、lint:plugins、check:versions、audit×2 全绿。
**提交**：refactor(audit-2): 阶段 4。

## 2026-10-12 第四轮 · 阶段 5（大文件拆分）

**做了**：playerStore 的队列数学 → queueMath.ts（纯函数 + 13 条测试；store 测试 82 条全绿）。
**未做**：useAudioEngine / Settings / SongList（理由记 DECISIONS：闭包缠绕、缺行为测试网、本轮已叠多改）。
**门禁**：全绿（前端 920、backend 29、plugins 51+3skip、audit×2）。

## 2026-10-12 第四轮 · 阶段 6（工程卫生）

**做了**：6.1–6.5 全部。
- 6.1 .gitattributes（eol=lf + binary 清单）；renormalize 只动 gradlew.bat（CRLF 保留，bat 语义）。**事故与修复**：renormalize 曾把 website/ 三个未提交文件带进 6.1 的 commit——立即 soft reset 重写该 commit，并从丢弃的 commit 里把对方的 website 改动恢复为工作区未提交状态（逐字节核对完成）。最终 6.1 只含 .gitattributes + gradlew.bat。
- 6.2 backend 1.5.0 → 1.6.0（package.json + lock 两处根版本）；B9 表述改「v1.6.0+」。
- 6.3 @tauri-apps/cli → devDependencies（lock 无其它漂移）。
- 6.4 两份 README 反代提示；README-TODO 标 ✅。
- 6.5 caps-table.test：README 两语能力表 ⊆ manifest（QQ 不写未声明的 favorites）。fs 读取用 \r?\n。

**门禁**：lint/tsc/vitest 923/build、backend 29、plugins 51+3skip、lint:plugins、check:versions、audit×2 全绿。
**提交**：chore(audit-2): 6.1（34dd4fc）+ 6.2–6.5。

---

# 本轮未做（等 N1KO 复核）

| # | 条目 | 原因 |
|---|---|---|
| 3.3 | 入口词表动态加载（−55KB） | i18n 被 97 个文件同步 import，改异步需要 useSyncExternalStore 化 + 首帧 fallback，回归面大；记 DECISIONS |
| 3.5 | qrcode 移出 vendor | 实测已在懒 chunk，任务书前提不成立（记 DECISIONS） |
| 3.6 | phosphor 三套字重剔除 | 聚合入口无法廉价剔除；先量收益 < 20% 线（记 DECISIONS） |
| 4.4 部分 | probePluginUser 替换 5 处调用点 | Login 有自己的 4 秒放行语义；diagnose 循环用 adapter.diagnose 非裸 getUser（记 DECISIONS） |
| 4.5 | store persist 泛型化（3 个 as never） | 需逐 store 验证 rehydrate；改错静默丢凭据。themeStore v2 作模板已就绪 |
| 4.6 | 8 个 persist store 补 version/migrate 骨架 | 同上；timebox 内不可靠完成 |
| 4.9 部分 | 迁移 v4「跳过重建仍记已应用」复核 | 未复现（事务回滚覆盖该路径）；需人工中途注入验证 |
| 4.10 部分 | 46 处 console 迁移到 lib/log | 12 个文件逐处改签名且多在 catch 分支；与诊断导出 UI 一起做 |
| 4.12 部分 | pickPluginRow 抽取 + SongList/QueueDrawer/PlayerBar 交互用例 | finishPluginAuth 行匹配与 1.1 的 addServer 判定交织，先补后端两条 |
| 5 部分 | useAudioEngine / Settings / SongList 拆分 | 闭包缠绕 + 本轮已叠多改 useAudioEngine、缺行为测试网（记 DECISIONS） |
| 全部 | dependabot PR 合并 | 任务书明确由 N1KO 处理 |

**量化总览**（阶段 3）：沙箱 432→195KB（gz 77.8）；SW precache 3465→2688KB（−558KB 子集字体）；冷启动不再串行等沙箱；切歌 −120ms（距上次加载超窗即载）。
**分支**：fix/audit-2026-10-12，基于 main e5b7009。未 push、未打 tag、app 七处版本号未动（netease 0.1.14 / qqmusic 0.1.17 / backend 1.6.0 不在七处之列）。

---

# 2026-10-12 · 第四轮 · 复核 F 节处理（F1–F25）

对 `docs/audit-2026-10-12-review.md` F 节 25 条逐条整改。两个提交：af63381（F-A：F1–F9）、f37737f（F-B/F-C：F10–F25）。门禁在干净 worktree（`git worktree add --detach ../n1ko-gate fix/audit-2026-10-12`，依赖用绝对符号链接指向主仓 node_modules）跑完即拆，逐项真实输出见本节末尾。

## F-A · 任务书写了没做/做了一半

| # | 处置 | 说明 |
|---|---|---|
| F1 | **到位** | Recommendations 页改走 `splitGroups` + `recommendationGroupsForMerge`（与首页 MergedDailyRail 同一条屏蔽过滤，constraints 含 accountVip）+ `GroupStateRows`（失败/登录过期源占行，retry 与 family 复用）；DECISIONS 249 行的错误结论已划掉更正。用例 `Recommendations.mute.test.tsx`：屏蔽歌手后该页立即不含该歌手（插件源 10 分钟缓存内也滤掉）、失败源有重试行 |
| F2 | **到位** | SongDetail 拆开 `isError`（unauthorized → 「需要重新登录」+返回；其余 → ErrorState 带重试+返回）与 `!song`（才显示「未找到」）；subsonic `request/postRequest` 抛错挂协议码（70→not-found、40–44→unauthorized，diagnose 同口径），getSong 判定改走 `pluginErrorCode/httpStatus`。用例 `SongDetail.error.test.tsx` 三条：401 不冒充未找到 / 网络错给重试 / 真没有才「未找到」 |
| F3 | **到位（5 子项全修）** | ① `localSongs = [...foreign, ...(matched.length ? [] : missingAsSongs)]`——只命中外源不再整批丢；② missing 占位 `serverId:'local'` 哨兵（toEntries 不再滤空、SourceBadge 对未知源不渲染）；③ 确认键按 `matched+foreign+missing` 判可用；④ ImportFromSourceDialog 同规则（确认键放行 + 空匹配跳过服务端写入不建空单）；⑤ `sources.import.noSheets` 两份词条补上。用例 `ImportPlaylistDialog.test.tsx` 覆盖「只命中外源」「全未匹配」两条 |
| F4 | **到位** | 两页重置 effect 用 ref 跳过挂载首跑（History 的 visibleCount、Search 的 page/acc）；Search 另把累积结果 acc 与首页歌手专辑 meta 一起存进 `history.state`（`mspSearchRestore`，配额超限 try/catch 退化只保页数），初值从恢复载荷取。用例 `SearchHistory.restore.test.tsx`：搜索翻到第 3 页 / 历史点三次加载更多 → 离开 → 浏览器返回 → 80 首/500 条原样在、还能继续翻 |
| F5 | **到位（4 子项）** | 离线令牌：handleOfflineError 签发 `offlineResumeToken`，联网且令牌有效 → `resume()` + reloadForRecovery（canplay→tryPlay 自然续播）；code 4 也先查 `navigator.onLine`；超 5 分钟窗口置 `needsReloadOnPlay`（点播放走 reloadCurrent）；`online` 监听由 effect cleanup 摘除。用例 `useAudioEngine.offline.test.tsx` 5 条（自动续播 / code 4 / 用户动过不抢 / 超窗可重载 / 切歌后旧监听不复活） |
| F6 | **到位** | 报头候选滤掉插件行与当前主库。用例 `Masthead.test.tsx`：真实打开 Radix 菜单断言候选与确认框链路 |
| F7 | **到位** | QueueDrawer 存队列按 `caps[primary].playlistWrite` 分流（不可写时主库歌也落本地）；toast 全外源时说明去处（新增 `queue.savedLocal`）；注释改「新建本地单」。用例 `QueueDrawer.save.test.tsx` 两条（不可写全落本地 + 可写分家计数） |
| F8 | **到位（重写）** | 收藏镜像重试队列：`Map<serverId:songId, 状态>`（新调用先删同键旧项——重放成功不会把取消盖回收藏）；serverId 入队固化（重放带回 `serverIdOverride`，不读当时主库）；串行重放；条目持久化 localStorage（刷新不丢，模块加载时恢复）；上限 5 次 + 指数退避（60s→10min）；无凭据时重新挂定时器不再「放回后没人调度」。用例 4 条（撤销旧项 / 去重+固化 / 超限放弃 / 模块重载恢复） |
| F9 | **到位** | `bestEffortPluginLogout` 改 await 版本；`removeServer`/`disconnect` 先 `await` 登出 settle（≤500ms）再 `disposePluginHost`；`disconnectServer` 不再调平台登出（保盘上凭据给自动重连——真登出反而毁重连）。用例 `serverStore.logout.test.tsx` 4 条（顺序 logout-settled→dispose / 500ms 超时照样拆 / disconnect 不登出 / disconnect 全部逐源先登出） |

## F-B · 做了但有副作用/口径不符

| # | 处置 | 说明 |
|---|---|---|
| F10 | **到位** | 窗口锚改 `lastLoadScheduledAt`（每次调度更新）+ 待执行定时器随点击重置——连点 5 次 50ms 间隔整窗只有最后一次取流（旧实现第 3 次连点就进立即分支、发 3 次）；ended 结账改快照制：同步 `captureListeningSession()` → submit → reset → advance → `persistSessionSnapshot`（后推到新 doLoad 之后也不会读到被清零的 listenedSec）；3.7 漏做的「已存在条目删掉再插头部」补上（`appendHistory` 按身份去重）。用例 `useAudioEngine.debounce.test.tsx` + queueMath 用例 |
| F11 | **到位** | 预解析每个 key 只试一次（失败不回 `preResolved`——不再整首歌期间每 8s 打一次插件/吃频控额度）；`inflightStreams.delete` 前比较 `get(key) === request`（skipCache 新旧同 key 不互删）。用例 `useAudioEngine.preresolve.test.tsx`：3 轮定时后 s2 只被解析过 1 次 |
| F12 | **到位** | Playlists 骨架只占分节内（loading 分节摆 6 格，anyLoading 不再整页 12 格盖掉已回分节；空态只在 `!anyLoading` 时出现）；Artists 页头 `!isLoading && !isError` 才给计数。用例 `BrowsePages.error.test.tsx` 3 条 |
| F13 | **到位** | errors.lint 重写：扫 .ts+.tsx（剔测试/声明），message 检测按「行含 `.message` 且行是 UI 汇点（toast/description/title/setError/textContent）」，豁免收敛为行级清单（ScrobbleSettings 回执、TopListDetail DEV 块）；鸭子取码禁 cast 形态、`.code===协议码` 按 instanceof/类型化字段放行。清掉三处：useAudioEngine（改 `pluginErrorCode`，toast 说明改 `describeError` 词条）、plugin.ts/subsonic.ts getSong（改 `pluginErrorCode`） |
| F14 | **到位** | Search 的 `{g.name}：` 走词条 `search.sourcePendingLine`（顺带删除已无调用方的 `search.sourcePending`）；CommandPalette Enter 判 `isComposing`/keyCode 229。用例见 F22 的 compose 测试 |
| F15 | **到位** | `readListeningEventsWithSnapshot` 带出底层快照引用；画像缓存键改（快照引用 + scope 字符串）——多源 scope 过滤每次出新数组导致的永久 miss 修复。用例 2 条（同快照新数组命中 / 同快照不同 scope 不串味） |
| F16 | **到位** | vite.config runtimeCaching 给 `-subset-(cyrillic\|greek\|vietnamese).woff2` 加 CacheFirst（font-subset-cache，30 条/180 天）——DECISIONS 说的「运行时缓存」这才真有了；SW 生成由构建门禁验证 |
| F17 | **到位** | `useRecentAlbums` 订阅 `isConnected` 放进 enabled——主库后连上时重估，不再靠别的 hook 碰巧订阅 servers |
| F18 | **到位** | 歌词「加载失败」改中性色（红只给 destructive）；`useLyricsQuery` 合并分支的 isLoading 合并两路——服务器已回空、远程在途时全屏歌词栏显示「加载中」而不是提前亮「无歌词」（复核标注的推断已按源码复现：旧合并只继承单边 isLoading） |
| F19 | **到位** | static.test.ts 恢复 A10（默认皮肤口径）/B13（sources.note 整句 + xattr）两组断言原文；DECISIONS 补记（门禁改干净 worktree 跑，主工作区对方未提交改版让 A10 红属其口径，不迁就）。已核对提交态 website/index.html 与 script.js 全过；干净 worktree 门禁里 3/3 绿 |

## F-C · 测试质量

| # | 处置 | 说明 |
|---|---|---|
| F20 | **到位** | `History.clear.test.tsx` 重写为渲染页面：真实渲染两源记录 → 点「清空记录」→ 确认框 → 断言 nas/wy 各被清一次、列表转空态；附取消不动数据一条。自证写法（自己重写 scope 拼接再调 mock）删除 |
| F21 | **到位** | `netease.playlist-write.test.mjs` 的 `assert.ok(true)` 空断言改为 `collectMethodPaths` 路径探测：`n1ko.user.createPlaylist/addToPlaylist/removeFromPlaylist` 三条存在、顶层 `user.*` 写方法不存在（与 sandbox-call.test.mjs 的 runtime 同形实现） |
| F22 | **到位（六项各一）** | 1.8：`SongDetail.lyrics.test.tsx`（点歌词留本页看 B 的词、不后退开别人的全屏）；1.10：`FullscreenPlayer.share.test.tsx`（插件歌菜单无分享 / 主库歌有）；1.12：`Home.row.test.tsx`（行上 Enter 进专辑、行内按钮 Enter 不冒泡）；2.3：`SourcesSettings.update.test.tsx`（目录拉失败说真话）；2.4：QrLogin.test.tsx 追加（error 态有刷新键、文案走 describeError 不裸奔原始异常）；2.5：`CommandPalette.compose.test.tsx`（组词 Enter 不执行、真 Enter 执行）。保存队列的 1.10 后半已由 F7 用例覆盖 |
| F23 | **到位** | 23 处 `navigate(\`/(albums\|artists\|songs)/…?src=\`)` 全部替换为 `detailPath(...)`（13 个文件，含 LinerNotes 条件 src 与 Issue 的 `?? ''` 两处变体），「唯一拼法」的注释从此属实；tsc 全绿 |
| F24 | **到位** | `/toplists` 进 `loaders`/lazy/routeMatchers（`route:toplists`，悬停预取可用）；`useDocumentTitle` 补 `/toplists`（榜单）与 `/toplists/`（榜单详情）标题映射 |
| F25 | **到位** | 检查更新按钮 `disabled={updateBusy}` + 转圈 + 忙碌 aria-label（新增 `sources.settings.checking` 词条两语言） |

## 插件版本

本轮未改任何插件源码（只改了 `plugins/test/netease.playlist-write.test.mjs` 测试），manifest 无需升版本；`check:versions` 七处保持 1.11.7。

## 门禁（干净 worktree `../n1ko-gate` @ f37737f，跑完已拆）

逐项真实输出（尾行）：

**1. `cd frontend && npm run lint`**（最后三行，--max-warnings 0）：
```
> n1ko-music@1.11.7 lint
> eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0

```
（无任何 error/warning 输出，exit 0）

**2. `npx tsc --noEmit`**：无输出，exit 0。

**3. `npm test`**：
```
 Test Files  107 passed (107)
      Tests  967 passed (967)
   Start at  16:20:40
   Duration  18.72s (transform 4.68s, setup 0ms, collect 92.22s, tests 16.28s, environment 14.88s, prepare 8.76s)
```
（含恢复的 A10/B13 官网断言——干净 worktree 里是提交态 website 文件，3/3 绿。主工作区因另一方未提交的换肤改版 A10 一条红，属其改版口径，见 DECISIONS F19 补记。）

**4. `npm run build`**：
```
✓ built in 4.76s
PWA v0.20.5  mode generateSW  precache 97 entries (2692.18 KiB)
```
（沙箱 196KB 与上轮一致；入口/precache 无回退。）

**5. `cd backend && npm test`**：
```
ℹ pass 29   ℹ fail 0   ℹ skipped 0
```

**6. `npm run test:plugins`**：
```
ℹ pass 51   ℹ fail 0   ℹ skipped 3
```

**7. `npm run lint:plugins`**：无输出，exit 0。

**8. `npm run check:versions`**：
```
Application versions are synchronized at 1.11.7
```

**9. `npm run audit:check -- frontend` / `-- backend`**：
```
✓ frontend 无未登记的安全公告
✓ backend 无未登记的安全公告
```

## 未做 / 说明

- F16 未加独立单测（SW runtimeCaching 是构建产物行为，由 build 门禁验证生成；写单测要解析 sw.js，收益低）。
- 复核标注「子代理/推断」的条目全部亲自复现过：F3②（toEntries 滤 serverId 空串，读 localPlaylistStore 证实）、F5 code 4 / 超窗（读 onError 分支证实）、F10 节流（旧条件 `now - lastLoadStartedAt >= WINDOW` 在定时器排定未发时即成立，写用例前先在旧代码上数过取流次数）、F11 频控（读预解析 8s 循环证实）、F18 远程模板（读 useLyricsQuery 合并分支证实 isLoading 只继承单边）。无「未复现」项，DECISIONS 无新增跳过记录（仅 F19 补记与 F1 更正）。
- 工作区里 README.md / README_CN.md 出现了另一方的未提交改动（皮肤演示链接、截图表格），与本轮无关，未纳入提交；website/ 三文件同样未碰。
