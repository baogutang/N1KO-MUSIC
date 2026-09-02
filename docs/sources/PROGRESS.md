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
