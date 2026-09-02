# 多音源聚合：实施计划

> 状态：已由 N1KO 于 2026-09-02 拍板。执行方按阶段推进，每个阶段结束停下来等验收。
> 协议合同见 [PROTOCOL.md](./PROTOCOL.md)；执行方的工作规则见 [AGENT-PROMPT.md](./AGENT-PROMPT.md)；过程中的偏离记在 [DECISIONS.md](./DECISIONS.md)。

## 1. 目标与边界

**目标**：让没有 NAS 的人也能用 N1KO。用户用自己的账号扫码登录流媒体平台，App 把 NAS 与平台当作平等的「音源」聚合起来：一次搜索多源返回、推荐跨源、队列可以混、同一首歌多来源时按优先级播。

**第一批做**：底座改造、插件运行时与沙箱、Mock 插件、聚合界面、网易云插件、QQ 音乐插件、歌单导入与本地混合歌单。

**明确不做**：

- 汽水音乐（没有开放平台，字节的客户端签名不值得现在去破）。
- Apple Music（需要 Apple Developer 会员生成 MusicKit token，目前没有）。
- 任何「免费听 VIP」「无损解析」类音源。只做「用自己的账号听自己有权听的」。
- Web 正式版（Docker 部署那份）的插件网络通道。浏览器里的 CORS 需要代理，第一批只做 App 与桌面版；Web 正式版界面上明确提示「流媒体音源需要 App 或桌面版」。
- 跨平台反向写回（把 NAS 歌单推到网易云）。
- 版本号变更与发版。版本号在七个地方要同步，那是发布流程的事，执行方不要碰。

## 2. 已经拍板的设计决定

1. **产品形态是聚合**，不是「一次只连一个源」。多源同时连接；`activeServerId` 语义改为「主库」，只影响默认浏览页与新建歌单落在哪。没有 NAS 的用户主库可以是一个插件音源。
2. **音源即插件**。协议兼容 MusicFree，加 `n1ko` 扩展。插件开发期放本仓库 `plugins/`，App 内有「插件目录地址」设置，默认在开发态指向本地目录，正式版默认为空。
3. **沙箱**：opaque-origin iframe + 自带 CSP，插件不能直连网络，只能经宿主转发，宿主按 manifest 域名白名单放行并记录。
4. **宿主网络**：Capacitor 用 `CapacitorHttp.request()` 显式调用，不开全局补丁；Tauri 加 `tauri-plugin-http`；浏览器开发态走 Vite 中间件代理；其余环境退回原生 `fetch` 并把 CORS 失败翻译成可读提示。
5. **取流**：适配器新增可选异步方法 `resolveStreamUrl`，返回地址与过期时间；播放引擎按歌曲的 `serverId` 找适配器；出错或过期时重取一次。播放引擎不支持自定义请求头，协议里保留字段但宿主忽略。
6. **注册表替代单例**：`getAdapterFor(serverId)`；旧 `getAdapter()` 保留，返回主库适配器。所有 mapper 必填 `serverId`。
7. **凭据**：插件返回不透明凭据串，宿主经 `securePersistStorage` 加密落盘，只在设备上，不进 sync backend。凭据失效时顶部横幅提示重新登录，不静默失败。
8. **登录界面**：登录页新增「流媒体音源」分组；登录方式按 manifest 渲染；首次添加展示 `disclaimer` 并要求确认。
9. **搜索结果按来源分组，顶部有「全部」切换**；「全部」视图里同曲合并成一条带来源标。
10. **同曲匹配**：ISRC 相同直接命中；否则标题 + 歌手 + 时长误差 2 秒内；再否则模糊匹配并标出让用户确认。播放优先级默认 NAS 优先，可配置。
11. **导入**：平台歌单与收藏可导入主库歌单，产出未匹配清单；未匹配的可放进「本地混合歌单」。
12. **质量门**：`npm run lint`（`--max-warnings 0`）、`tsc`、`vitest` 全绿；新增逻辑有单测；需要真机和手机的扫码流程交人工验收清单。

## 3. 现状与对接点

代码摸底结论（文件行号以当前 main 为准，执行前请核对）：

| 现状 | 位置 | 处理 |
|---|---|---|
| 统一适配器接口已存在，可选方法靠能力探测隐藏入口 | `frontend/src/api/types.ts` 329-451；`frontend/src/hooks/useServerCapabilities.ts` | 沿用；新增可选方法与 `SourceCapabilities` |
| 全局单例适配器，34 个文件直接 `getAdapter()` | `frontend/src/api/index.ts` | 阶段 0 换成注册表 |
| `getStreamUrl` 同步、永不过期，播放引擎只有格式回退 | `types.ts` 343-350；`frontend/src/hooks/useAudioEngine.ts` 455、543、955-978 | 阶段 0 加 `resolveStreamUrl` 与过期重取 |
| 登录页写死地址 + 账号 + 密码，且绕过 `createAdapter` 直接 new | `frontend/src/pages/Login.tsx` 23-28、63-143 | 阶段 0 走 `createAdapter`；阶段 1 按 manifest 渲染 |
| 凭据加密落盘的 `collect / apply` 清单 | `frontend/src/store/serverStore.ts` 167-184；`frontend/src/store/securePersistStorage.ts` | 把插件 `credentials` 加进清单 |
| `Song.serverId` 声明了但没有 mapper 填过 | `types.ts` 74-75；`subsonic.ts` / `jellyfin.ts` 的 `mapSong` | 阶段 0 全部填上 |
| 查询 key 已按 `activeServerId` 分域 | `frontend/src/hooks/useServerQueries.ts` 35-40 | 聚合查询改为按 `serverId` 各自一条再合并 |
| `removeSongsFromPlaylist` 传下标 | `types.ts` 371；`jellyfin.ts` 707-740 有翻译范式 | PluginAdapter 照 Jellyfin 翻译成 id |
| 深链接 id 白名单不接受冒号 | `frontend/src/services/deepLink.ts` 44 | id 不加前缀，靠 `serverId` 分域，无需改 |
| `Artist.sortIndex` 由服务器给 | `types.ts` 175-181 | PluginAdapter 自己生成 |
| Tauri CSP `frame-src 'none'`、`script-src 'self'` | `frontend/src-tauri/tauri.conf.json` | 阶段 1 放开 `frame-src blob:`、`script-src 'self' blob:` |
| Capacitor 8，没装 Preferences、SecureStorage、Http 插件 | `frontend/capacitor.config.ts`；`frontend/ios/App/Podfile` | `CapacitorHttp` 在 core 里，无需新插件 |
| 推荐引擎按画像拉候选再排序 | `frontend/src/hooks/usePersonalizedRecommendations.ts`、`frontend/src/services/radio.ts` | 候选来源扩到所有已连接音源 |
| 本地 Mock Subsonic 服务与截图脚本 | `scripts/mock-subsonic.mjs`、`scripts/shoot-screenshots.mjs`、`.claude/launch.json` | 复用做验收 |
| 历史审计里跨服务器串数据的教训 | `docs/audit-2026-07-21.md` 高-4、高-5、高-6、中-14 | 开工前通读，多源会把同类问题重新打开 |

## 4. 架构

### 4.1 分层

```
界面 · 播放引擎 · 队列 · 听歌记录            只认 Song.serverId，不认来源类型
────────────────────────────────────────────
适配器注册表  getAdapterFor(serverId)         阶段 0
MusicServerAdapter 接口 + SourceCapabilities
  SubsonicAdapter | JellyfinAdapter/Emby | PluginAdapter（新）
────────────────────────────────────────────
PluginHost：沙箱 iframe + RPC + 凭据 + 请求日志   阶段 1
  ↳ 沙箱内：plugin-sandbox.js 运行时 + 插件代码
────────────────────────────────────────────
hostFetch：CapacitorHttp | tauri-plugin-http | Vite 开发代理 | fetch
```

### 4.2 新增与改动的模块

```
frontend/src/api/
  index.ts                 注册表：registerAdapter / unregisterAdapter / getAdapterFor / listAdapters / setPrimary / getAdapter（=主库）
  types.ts                 ServerType 增 'plugin'；ServerConfig 增 pluginId、credentials、autoConnect；
                           MusicServerAdapter 增 resolveStreamUrl?、getSourceCapabilities?、getTopLists?、getTopListDetail?、getRecommendSheets?
  adapters/plugin.ts       PluginAdapter
frontend/src/plugins/
  types.ts                 manifest、RPC 消息、插件方法签名
  host/PluginHost.ts       一个插件实例一个沙箱；init / call / dispose；超时；请求日志环形缓冲
  host/hostFetch.ts        网络通道选择 + 域名白名单
  host/sandboxDocument.ts  生成 blob: 文档
  host/pluginStore.ts      已安装插件（zustand persist，代码放 IndexedDB `n1ko-music-plugins`）
  host/catalog.ts          插件目录拉取与更新检查
  sandbox/runtime.ts       沙箱内运行时（单独打包成 public/plugin-sandbox.js）
  sandbox/shims/           axios、big-integer 兼容层
  mapping.ts               MusicFree 形状 → App 类型
  match.ts                 同曲匹配（纯函数）
frontend/src/pages/Login.tsx           流媒体音源分组 + 按 manifest 的登录步骤（QR / Cookie / 匿名）
frontend/src/components/sources/       SourceBadge、QrLogin、CookieLogin、PluginDisclaimer、SourceAccountBanner
frontend/src/pages/Settings.tsx        新「音源」区块（组件放 components/settings/SourcesSettings.tsx）
frontend/src/hooks/useSourceQueries.ts 多源并发查询与合并
frontend/vite.sandbox.config.ts        运行时单独构建
frontend/vite.config.ts                开发态中间件：/__n1ko_plugins/*（本地目录）与 /__n1ko_proxy（代理）
frontend/src-tauri/                    tauri-plugin-http + CSP 调整 + capability
plugins/
  README.md                目录结构、如何本地调试、发布前拆仓库的说明
  catalog.json             [{ id, name, version, manifest, entry }]
  mock/                    manifest.json + index.js
  netease/                 manifest.json + index.js（+ lib/crypto.js）
  qqmusic/                 manifest.json + index.js（+ lib/sign.js）
  test/harness.mjs         Node 里加载插件的测试骨架（axios 走 undici fetch，crypto-js 用 npm 包）
  test/*.test.mjs          node --test
```

### 4.3 宿主网络通道

| 环境 | 判定 | 通道 |
|---|---|---|
| iOS / Android | `frontend/src/lib/platform.ts` 的 `isNativePlatform` | `import { CapacitorHttp } from '@capacitor/core'`，`CapacitorHttp.request({ url, method, headers, data, responseType })`。不在 `capacitor.config.ts` 里开 `CapacitorHttp.enabled`，避免全局补丁影响现有 axios 行为。 |
| Tauri 桌面 | `'__TAURI_INTERNALS__' in window`（`frontend/src/hooks/useDeepLinks.ts` 31 行已有这个判定，抽到 `platform.ts` 里共用） | `@tauri-apps/plugin-http` 的 `fetch`。Cargo 加 `tauri-plugin-http = "2"`，`lib.rs` 注册 `tauri_plugin_http::init()`，`capabilities/default.json` 加 `http:default` 并把 scope 放到 `http://**` 与 `https://**`。 |
| 浏览器开发态 | `import.meta.env.DEV` | Vite 中间件 `/__n1ko_proxy?url=…`，只转发白名单内域名，不落盘不记录 body。 |
| 浏览器正式版 | 其余 | 原生 `fetch`；失败时错误码 `network`，界面提示「流媒体音源需要 App 或桌面版」。 |

响应统一为 `{ ok, status, headers, body, bodyEncoding }`；二进制走 base64。

### 4.4 播放引擎的改动

- 取流入口改为 `resolveStream(song, quality)`：适配器有 `resolveStreamUrl` 就 `await`，否则包一层同步的 `getStreamUrl`。结果按 `buildLoadedKey` 缓存，附 `expiresAt`。
- `MediaError` 恢复路径：若来源是异步取流型，先绕过缓存重取一次再走现有的格式回退；格式回退逻辑只对 URL 带 `format` 参数的 Subsonic 系流有效，保持原样。
- 预热（`preloadNext`）同样走 `resolveStream`；预热的地址在正式加载时若已过期则重取。
- `scrobble`、`reportPlayback` 按 `song.serverId` 找适配器。
- 队列允许混源。断开某个音源时从队列里移除它的曲目；切换主库不清队列。`resetForServerChange` 的调用点逐个审视。

### 4.5 聚合查询

- 每个音源一条 React Query（key `[serverId, ...]`），用 `useQueries` 并发，`useSourceQueries` 负责合并、保序、把单源失败降级成该分组的错误态而不是整页错误。
- 搜索页：分组视图按音源顺序（主库在前）；「全部」视图跑 `match.ts` 合并同曲，一条曲目带多个来源标，播放时按优先级选。
- 推荐：候选拉取在 `usePersonalizedRecommendations.ts` 与 `services/radio.ts`，把「对主库调 `getArtistSongs / getSimilarSongs`」改成「对所有声明了 `radio` 能力的音源各拉一份再合并」。排序逻辑不动。

## 5. 分阶段任务

每个任务写明「做什么、验收标准、涉及文件」。执行顺序就是列表顺序；同一阶段内标了 ∥ 的任务可以并行。

### 阶段 0 · 底座（不新增任何用户可见功能，现有行为不变）

**0.1 类型扩展**
- `ServerType` 增 `'plugin'`；`ServerConfig` 增 `pluginId?`、`credentials?`、`autoConnect?`（默认 `true`）。
- `MusicServerAdapter` 增可选 `resolveStreamUrl(songId, opts: { maxBitrate: number; quality: 'lossless'|'high'|'medium'|'low' }): Promise<{ url: string; expiresAt?: number; mimeType?: string }>`、`getSourceCapabilities(): SourceCapabilities`、`getTopLists?()`、`getTopListDetail?()`、`getRecommendSheets?()`。
- 新增 `SourceCapabilities`（字段见 PROTOCOL §6，另加 `libraryBrowse`、`radio`），`useServerCapabilities` 的 `ClientCapabilities` 合并进去，现有三个适配器补 `getSourceCapabilities`，Subsonic / Jellyfin 声明 `libraryBrowse: true`。
- `Song / Album / Artist / Playlist` 的 `serverId` 改为必填，所有 mapper 填上；适配器构造参数增 `serverId`，`createAdapter` 传 `config.id`。
- 验收：`tsc` 通过；`subsonic.test.ts`、`jellyfin.test.ts` 断言 `serverId`。

**0.2 注册表**
- `frontend/src/api/index.ts`：`registerAdapter(serverId, adapter)`、`unregisterAdapter(serverId)`、`getAdapterFor(serverId)`、`listAdapters()`、`setPrimary(serverId)`、`getAdapter()` 返回主库并保持抛错语义、`hasAdapter()`。
- `serverStore`：`connectedServerIds: string[]`；`connectServer(id)`、`disconnectServer(id)`、`setPrimaryServer(id)`；`activateServer` 保留为「connect + setPrimary」；rehydrate 时把所有 `autoConnect` 的服务器都连上；`removeServer` 同时 `unregisterAdapter`；`getServerTypeLabel` 加 `plugin`。
- 34 处 `getAdapter()` 调用逐个分类：**针对某个 Song / Album / Playlist 的操作**改 `getAdapterFor(item.serverId)`；**浏览主库**的保留 `getAdapter()`；**发现类**（搜索、推荐候选）留给阶段 2 的 `useSourceQueries`，此处先不动但加 `// TODO(sources)` 标记。
- 验收：`api/index.test.ts` 覆盖注册 / 注销 / 主库切换 / 未注册抛错；现有 Subsonic 登录、切换、移除流程在浏览器里手测无变化。

**0.3 播放引擎** ∥ 0.2 之后
- `frontend/src/utils/audioEngine.ts` 加纯函数 `isStreamExpired(expiresAt, now, marginMs = 30_000)` 与 `resolveStream` 的缓存键逻辑，单测。
- `useAudioEngine.ts` 按 §4.4 改造。
- 验收：`utils/audioEngine.test.ts` 新增用例；用一个假适配器（`resolveStreamUrl` 返回 5 秒后过期的 data: URL）在浏览器里验证过期重取路径。

**0.4 登录页走工厂**
- `Login.tsx` 的 `handleConnect` 改为：临时适配器 `login()` → `addServer` → `activateServer`，不再直接 new 适配器类。
- 验收：Subsonic / Jellyfin 登录手测无变化。

### 阶段 1 · 插件运行时、Mock 插件、音源管理

**1.1 沙箱运行时**
- `frontend/src/plugins/sandbox/runtime.ts` 按 PROTOCOL §3、§4、§8 实现；`vite.sandbox.config.ts` 用 `build.lib` 打成 `public/plugin-sandbox.js`（IIFE）；`package.json` 加 `build:sandbox`，并在 `predev`、`prebuild`、`prebuild:mobile`、`pretest` 里调用；`public/plugin-sandbox.js` 进 `.gitignore`。
- `crypto-js`、`dayjs`、`qs`、`he` 作为运行时依赖打进去；`axios` 与 `big-integer` 是自写兼容层。
- 验收：`sandbox/runtime.test.ts` 用假的 `postMessage` 通道测 init → ready → call → result、fetch 往返、超时、错误码透传。

**1.2 PluginHost 与 hostFetch**
- 按 PROTOCOL §8 与本文 §4.3 实现；域名白名单；请求日志环形缓冲（每插件 200 条：时间、方法、URL、状态、耗时，不存 body 与 Cookie）。
- Tauri：Cargo、`lib.rs`、capability、CSP 一并改；`cargo check` 能过就跑，跑不了在 DECISIONS.md 记明「未验证」。
- 验收：`hostFetch.test.ts` 覆盖白名单匹配（精确、`*.` 通配、端口、大小写）；开发态中间件代理能转发 `https://music.163.com/` 的 HEAD 请求。

**1.3 PluginAdapter 与映射** ∥ 1.2
- `frontend/src/api/adapters/plugin.ts`：实现接口必选部分；可选部分按 manifest `capabilities` 与沙箱回报的 `methods` 决定是否挂方法（没有就不定义，让能力探测自然隐藏入口）。
- `plugins/mapping.ts` 纯函数；原始项缓存；分页拉全歌单上限 2000 条；`removeSongsFromPlaylist` 下标翻译。
- 验收：`plugin.test.ts` 用假 host 覆盖每个方法的映射与错误码翻译。

**1.4 插件安装与目录**
- `pluginStore`：从 URL、从粘贴文本、从目录安装；代码哈希；更新检查；卸载清理凭据与私有存储。
- Vite 开发态中间件：`/__n1ko_plugins/catalog.json` 与 `/__n1ko_plugins/<id>/…` 直接读 `plugins/`。
- 设置里「插件目录地址」，开发态默认 `/__n1ko_plugins/catalog.json`，正式版默认为空。
- 验收：`pluginStore.test.ts`；浏览器里从本地目录安装 Mock 插件。

**1.5 Mock 插件**
- `plugins/mock/`：固定曲库（复用 `scripts/mock-subsonic.mjs` 的风格，中英混合），`auth.kind: 'qr'`，`checkQr` 前两次回 `waiting`、第三次 `scanned`、第五次 `confirmed`；`getMediaSource` 返回内存生成的 3 秒 WAV `data:` URL，`expiresAt` 设为 20 秒后以便测过期重取；有歌词、榜单、推荐歌单、用户歌单、收藏。
- 验收：`plugins/test/mock.test.mjs` 在 Node 里过一遍全部方法。

**1.6 登录与音源管理界面**
- `Login.tsx`：新增「流媒体音源 · STREAMING」分组，列出已安装插件与「添加插件」；选中后进入 `disclaimer` 确认 → 登录步骤（`QrLogin`：App 内用 `qrcode` 库渲染 SVG，2 秒轮询、过期一键刷新、状态文字四种；`CookieLogin` 放在「高级」折叠里；`allowAnonymous` 时有「先不登录」）。
- 登录成功：`addServer({ type: 'plugin', pluginId, credentials, name: 插件名 + 昵称 })`，`credentials` 进 `collect / apply` 加密清单。
- `SourceAccountBanner`：任一插件音源 `unauthorized` 时顶部横幅「网易云音乐登录已过期，重新扫码」。
- `SourcesSettings`：已安装插件列表（版本、账号、状态、更新、重新登录、请求日志、卸载）、添加、目录地址、播放优先级。
- i18n：`zh-CN.json` 与 `en-US.json` 同时加 key。
- 视觉：沿用 `Login.tsx` 的发丝线行式与 `components/settings/primitives.tsx`；颜色只用 `index.css` 的 token；两套皮肤、明暗四种组合都看一遍。
- 验收：浏览器开发态从头走通「添加 Mock 音源 → 确认声明 → 扫码 → 首页出现 Mock 歌单 → 播放 → 歌词 → 20 秒后过期重取」；截图四种组合放 `docs/sources/screenshots/phase1/`。

### 阶段 2 · 聚合界面

**2.1 `useSourceQueries`** 与来源徽标 `SourceBadge`（波普皮肤彩色小方块，纸墨皮肤单色描边；颜色来自 manifest 的可选 `color`，缺省按 id 哈希取 token 色）。
**2.2 搜索页**：分组 + 「全部」；「全部」里用 `match.ts` 合并同曲；单源失败只显示该组错误。
**2.3 首页**：继续播放、为你推荐（候选跨源）、每个音源的「我的歌单」「收藏」、榜单与推荐歌单区块（只对声明了能力的音源出现）。
**2.4 浏览页**：专辑、歌手、流派页只列 `libraryBrowse` 的音源；歌单页与收藏页按音源分节。
**2.5 播放页与队列**：曲目行、播放页、队列项显示来源徽标；多来源曲目可长按或点徽标切换来源。
**2.6 设置**：主库选择器、播放优先级。
- 验收：Mock 插件 + Mock Subsonic 同时连接，搜索「summer」能看到两组结果与「全部」合并；截图放 `docs/sources/screenshots/phase2/`。

### 阶段 3 · 网易云插件

- `plugins/netease/`：从 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 移植，不引它的包。要看的文件：`util/crypto.js`（weapi：AES-CBC + RSA；eapi：AES-ECB + 摘要）、`util/request.js`（请求头、Cookie、`__csrf`、`os`/`appver` 等参数）、`util/config.json`；接口模块：`login_qr_key`、`login_qr_create`、`login_qr_check`、`login_status`、`user_account`、`register_anonimous`、`user_playlist`、`playlist_detail`、`playlist_track_all`、`song_detail`、`cloudsearch`、`song_url_v1`、`lyric_new`、`likelist`、`like`、`toplist`、`top_playlist`、`album`、`artist_top_song`、`playlist_create`、`playlist_tracks`。
- RSA 用原生 `BigInt` 自己写模幂，不引 `big-integer`。
- 匿名模式：`register_anonimous` 拿匿名 Cookie 存进 `env.storage`，未登录也能搜索与听免费曲。
- 音质：`standard / higher / exhigh / lossless / hires` 映射到协议四档；账号无权时接口返回的 `fee` / `code` 翻译成 `forbidden`。
- 凭据格式：Cookie 字符串；`getUser` 调 `user_account`，拿不到 `profile` 视为失效。
- 测试：`plugins/test/netease.crypto.test.mjs` 用固定随机数与 api-enhanced 的实现比对 weapi 输出（在临时目录 `npm i @neteasecloudmusicapienhanced/api` 取参考值，不进仓库依赖）；`netease.live.test.mjs` 标记为需要网络，跑搜索、榜单、免费曲取流、二维码 key 创建，CI 里跳过。
- 人工验收清单（需要 N1KO 用手机）：扫码登录成功显示昵称头像；我的歌单与收藏；VIP 曲对会员账号可播；非会员账号 VIP 曲标灰并有原因；Cookie 失效后横幅出现；重新扫码后恢复。

### 阶段 4 · QQ 音乐插件

- `plugins/qqmusic/`：从 [luren-dc/QQMusicApi](https://github.com/luren-dc/QQMusicApi)（Python）移植：签名算法、`musicu.fcg` 请求封装、QQ 扫码与微信扫码登录（`ptqrshow` / `ptqrlogin` / 授权换 `musickey`）、凭据刷新、`vkey.GetVkeyServer` 取流（guid 随机生成一次存 `env.storage`）、搜索、歌单、收藏、歌词、榜单。先 clone 仓库定位这些模块，不要凭记忆写接口。
- 凭据格式：JSON `{ musicid, musickey, refresh_key, guid, loginType }`。
- 测试与验收同阶段 3；扫码需要 N1KO 的 QQ 或微信。

### 阶段 5 · 导入与本地混合歌单

- `match.ts` 已在阶段 2 就位；这里加 `ImportPlaylistFromSource` 对话框：选来源歌单 → 匹配进主库 → 新建或追加主库歌单 → 未匹配清单可一键「放进本地混合歌单」。
- 本地混合歌单：存 IndexedDB（`n1ko-music-local-playlists`），条目是 `{ serverId, songId }`，界面上与服务端歌单并列并带「本地」标；不同步到 backend（留接口）。
- 验收：Mock Subsonic 与 Mock 插件间导入，匹配率与未匹配清单符合预期；单测覆盖三级匹配规则。

## 6. 质量门与工作方式

- 每个任务结束：`cd frontend && npm run lint && npx tsc --noEmit && npm test`；`plugins/` 变更时 `npm run test:plugins`（根 `package.json` 加此脚本）。
- 分支 `feat/sources`，每个任务一个提交，提交信息沿用仓库风格（`feat(sources): …`、`chore(plugins): …`）。不推送，除非 N1KO 说推。
- 不改版本号，不动 `README` 的支持列表（发布时再改）。
- 每个阶段结束写 `docs/sources/PROGRESS.md`：做了什么、怎么验证的、截图路径、未完成项、待 N1KO 决定的问题。
- 与本文或 PROTOCOL 冲突时：先在 DECISIONS.md 记录「冲突是什么、选了哪条、为什么」，选侵入最小的那条继续，不要停下来等。只有在缺少凭据、需要手机扫码、或两种选择会导致返工超过一天时才停下来问。

## 7. 风险清单

| 风险 | 应对 |
|---|---|
| Tauri 的 CSP 拦住 blob: 文档或脚本 | 阶段 1.2 第一件事先在 Tauri dev 里验证沙箱能 ready；不行就改用 `srcdoc` 或把 `frame-src` 放到 `'self' blob:` |
| 原生 `CapacitorHttp` 拿不到 `set-cookie` | 网易云的登录态在 `login_qr_check` 的响应头里；拿不到时用 `CapacitorCookies.getCookies({ url })` 兜底，写进 hostFetch |
| 平台接口变动导致插件失效 | 插件独立于 App 更新；`live` 测试单独跑；错误码 `unknown` 时界面给出插件版本与「检查更新」 |
| 多源把审计里的串数据问题重新打开 | 每个 IndexedDB / localStorage / query key 都带 `serverId`；阶段 0 加一条 lint 级别的检查：mapper 返回值缺 `serverId` 时 tsc 报错（字段必填即可做到） |
| 聚合搜索把慢源拖成整页慢 | 分组各自 loading，「全部」视图在最快一组回来后先渲染，后续到达的组追加 |
| 队列里混源导致预热与 scrobble 打错适配器 | 一律按 `song.serverId`，单测覆盖 |

## 8. 参考

- MusicFree 插件协议：https://github.com/maotoumao/MusicFree/blob/master/src/core/pluginManager/plugin.ts
- 网易云社区接口（移植来源）：https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
- QQ 音乐社区接口（移植来源）：https://github.com/luren-dc/QQMusicApi
- Capacitor HTTP：`@capacitor/core` 的 `CapacitorHttp`、`CapacitorCookies`
- Tauri HTTP：https://v2.tauri.app/plugin/http-client/
- 本仓库设计契约：`docs/redesign/DESIGN.md`；皮肤 token：`frontend/src/index.css`
