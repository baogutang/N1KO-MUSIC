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
