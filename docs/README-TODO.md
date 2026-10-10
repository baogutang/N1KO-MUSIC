# README 待并入内容（由 N1KO 合并，执行方不直接改 README）

> 背景：2026-10-10 整改期间 README.md / README_CN.md 另有人在同时修改，
> 执行方（ZCode）不直接改 README。所有「想写进 README」的内容先落在这里。

## macOS 下载后提示「已损坏」（issue #1）

- 短期方案（已实现，v1.11.6 之后生效）：`tauri.conf.json` 的
  `bundle.macOS.signingIdentity` 设为 `"-"`，构建时做 ad-hoc 签名，
  消除「无法验证开发者」的 Gatekeeper 拦截。
- 下载区建议加一条说明（中英双语）：
  > macOS 首次打开若提示「“N1KO MUSIC”已损坏，无法打开」，请在终端执行：
  > `xattr -cr "/Applications/N1KO MUSIC.app"`
  > If macOS says "N1KO MUSIC is damaged and can't be opened", run:
  > `xattr -cr "/Applications/N1KO MUSIC.app"`
- 长期方案（未实现）：申请 Apple Developer ID，构建时签名 + 公证
  （`appleId` / `applePassword` / Tauri notarize 配置或 `notarytool`），
  用户下载后可直接打开，无需执行 xattr。

## 文档漂移（阶段 8.10 核实）

- README 里「两张皮 / 三张皮」表述前后矛盾：一处说两张皮，另一处说三张皮
  （clay / pop / editorial）。按现状应统一为三张皮，clay 为默认。
- README「仅两条出网」的表述漏了插件音源：网易云 / QQ 音乐插件音源也要出网
  到各自 API 域名，不只是 Navidrome/Subsonic 与同步后端两条。

## 同步章节如实性（阶段 8.9 核实）

- README 的同步（sync）章节应如实说明当前实际同步的内容：
  - ✅ 听歌历史（history，含增量 since 拉取）
  - ✅ 边注（notes，含 updatedAt 冲突保护，2026-10-10 起）
  - ❌ 播放列表（playlists 路由后端已实现，前端未接入）
  - ❌ 收藏增量同步（favorites since 接口已实现，前端未接入）
