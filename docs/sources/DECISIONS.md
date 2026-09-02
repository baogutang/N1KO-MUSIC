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

## 2026-09-02 · 阶段 0.2 · IssueEntry 增 serverId 字段
- 冲突：Issue 页封面按条目来源解析适配器（0.2 分类改造），但 services/issue.ts 的 IssueEntry 是从听歌事件聚合出的精简形状，没有 serverId。
- 选择：给 IssueEntry 增可选 serverId，由 rank / topArtists / topAlbums 从 song.serverId 透传。
- 原因：比「Issue 页永远打主库」更正确——听歌历史本就跨服务器（审计 高-4 同源问题）。
- 影响：services/issue.ts 一处类型 + 三处赋值；无需改协议文档。
