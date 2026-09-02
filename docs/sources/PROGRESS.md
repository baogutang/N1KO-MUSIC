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
