# 2026-10-12 任务书 · 复核记录

> 对 `docs/audit-2026-10-12.md` 各轮执行的复核。file:line 以复核时的分支 HEAD 为准。标「推断」的条目没有实跑，整改前先复现。

## F. 第一轮复核（b39da73…af353d0，分支 fix/audit-2026-10-12）

**门禁实况**：zcode 自述每阶段 lint 全绿，实际分支 HEAD 上 `npm run lint` 红——1 error（`styles/fonts-subset.test.ts:31` 无用 disable）+ 3 warnings（`SongList.tsx:328` memo 漏 `primaryCaps`、`usePersonalizedRecommendations.ts:297` 漏 `size`、`useServerCapabilities.ts:67` 注册表读取缺豁免注释）。`--max-warnings 0` 下三条工作流都会在第一步停下。**已由复核方修掉**（见本节末「复核方已改」）。其余门禁本地全过：tsc、vitest 923、build（沙箱 196KB、precache 97 条 2688KB）、backend 29、plugins 51+3 跳、lint:plugins、check:versions、audit×2。`website/` 三个文件没进任何提交，对方未提交改动完好。

**阶段完成度**：阶段 1 的 12 条里核实到位 1.2 / 1.4 / 1.5 / 1.6（实现）/ 1.12；阶段 2 到位 2.3（守卫）/ 2.4；阶段 3 到位 3.1（并行连源本体）/ 3.2 / 3.4（改名与 glob）；阶段 4 到位 4.1（字段推导）/ 4.2 / 4.3 / 4.9 / 4.12（后端两条）；阶段 5、6 到位（6.1 的 `.bat` 规则由复核方补）。下面是剩余问题，按用户可感知严重度排序；「核实」= 复核方亲自读过源码，「子代理」= 复核子代理报告、复核方未复跑。

### F-A · 任务书写了、实际没做或做了一半（用户仍会撞到）

| # | 对应 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| F1 | 1.9 | `frontend/src/pages/Recommendations.tsx`（整文件未改） | **没做**。DECISIONS 写「与 1.3 同根因、无剩余工作」是错的：1.9 是屏蔽过滤与失败源状态行，和 `?src=` 无关。「查看全部」页屏蔽后仍显示 10 分钟、失败源静默消失（核实） | 复用 `recommendationGroupsForMerge` + `mutedFingerprint` + `GroupStateRows`；更正 DECISIONS；补「屏蔽后该页立即不含该歌手」用例 |
| F2 | 1.11 | `pages/SongDetail.tsx:755`；`api/adapters/subsonic.ts:213,374-378` | 适配器改成抛错了，但页面仍是 `if (!song \|\| isError)` 同一分支，照样显示「未找到歌曲信息」——用户看到的没变。Subsonic 的「不存在」是 HTTP 200 + `code 70`，`request()` 抛的是裸 `Error`，`status===404 \|\| code==='not-found'` 永远不中（核实）。测试只测了 plugin 适配器 | 页面拆开：`isError` 走 ErrorState / auth 态，`!song` 才是「未找到」；Subsonic `request()` 把 `data.error.code` 挂到抛出的错误上（70 → `not-found`）；补页面用例（401 → 看到重试/登录，不是「未找到」） |
| F3 | 2.2 | `components/music/ImportPlaylistDialog.tsx:101-109,258`；`components/sources/ImportFromSourceDialog.tsx:234,357`；两份 locale | ① `localSongs = matched.length === 0 ? missingAsSongs : foreign`：全未匹配主库但命中外源时，**外源歌整批丢失**（核实）；② missing 转成 `serverId: ''`，被 `toEntries` 过滤，建出空本地单但 toast 写「N 首」（子代理）；③ 只命中外源时确认键仍灰（子代理）；④ ImportFromSourceDialog 的确认键没改（子代理）；⑤ `sources.import.noSheets` 两份词条都没有，界面直接显示 key（核实） | `localSongs = [...foreign, ...(matched.length ? [] : missingAsSongs)]`；按 `matched + foreign + missing` 判可用；两个对话框同规则；补词条；用例覆盖「只命中外源」「全未匹配」两种 |
| F4 | 3.12 | `pages/Search.tsx:153`；`pages/History.tsx:69` | 两页的重置 effect（依赖 `[debouncedQuery]` / `[historyScope]`）挂载时也跑，恢复出来的页数当帧被冲回 1 / 150，随后 replaceState 又把它写回——**两页的恢复都不生效**。Search 还有：各页独立 queryKey，acc 从空开始只累到第 N 页；挂载首帧白发一次第 N 页请求（子代理） | 重置 effect 用 ref 跳过首跑；Search 把累积结果一起存进 history.state，或恢复时按 1..N 顺序拉；补用例：恢复后 visibleCount 不被冲掉 |
| F5 | 3.11 | `hooks/useAudioEngine.ts:1366-1381,1395` | 处理器先 `pause()`，`onBack` 与 `tryPlay` 都只在 `isPlaying` 为真时才 play → 联网后只重载不续播，「不用手动点播放」不成立。只拦了 `code 2`；开播前取流失败是 `code 4`（推断）仍耗恢复次数；超 5 分钟窗口直接 return 没置 `needsReloadOnPlay`，之后点播放可能没反应（推断）；`online` 监听不在 cleanup 移除（子代理） | 记 `wasPlaying` + 「离线暂停令牌」（用户手动播放/暂停即作废），令牌有效时 onBack 调 resume；code 4 也先查 `navigator.onLine`；离线分支置 `needsReloadOnPlay`；cleanup 移除监听；引擎级用例 |
| F6 | 1.7 | `components/layout/Masthead.tsx:85`（`servers.map` 未过滤）；`useDestructiveConfirm.test.tsx` | 插件行照样提供「设为主库」（任务书明说不提供）；点当前主库也弹确认（核实）。测试只测 hook，报头改回去测不出来 | 滤掉插件行与当前主库；补「从菜单进入」的用例 |
| F7 | 1.10 | `components/player/QueueDrawer.tsx:143-153` | 没复用 `resolvePlaylistTargets`，不看 `playlistWrite`：主库是 QQ 插件时先抛错、外源部分也存不了；全外源时 toast 不说落到了本地；注释写「并进同名单」实际是新建（子代理） | 按 caps 分流，文案说明去处，补用例 |
| F8 | 4.11 | `services/historySync.ts:274-300` | 「60s 重试队列」：push 不去重、重放并发 `void` 不保序、新调用成功不撤销旧项（60s 后旧状态覆盖服务端新状态）、无重试上限（失败自己再入队）、纯内存刷新即丢（并没有「并入 outbox」）、取消收藏的 serverId 到重放时才取主库、无凭据分支放回后不再调度（子代理） | 改成按 `serverId:songId` 存最新状态的 Map，新调用先删同键待重试项；入队时固化 serverId；串行重放；持久化到 outbox；上限 + 退避 |
| F9 | 4.8 | `store/serverStore.ts:122,205,283` | `bestEffortPluginLogout` 发出后下一行就同步 `dispose`：iframe 拆掉、pendingCalls 全 reject、代理 fetch 全 abort，登出请求根本到不了平台，500ms race 等于不存在（子代理）。而且 `disconnectServer` 并不删盘上凭据——真登出成功反而让下次自动重连失效 | 只在 `removeServer` 里调用，`await`（最多 500ms）后再 dispose；`disconnect` 不调 |

### F-B · 做了但有副作用或与任务书口径不符

| # | 对应 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| F10 | 3.7 | `hooks/useAudioEngine.ts:1687,1289` | 窗口按「上次加载开始」算，实际成了节流：5 次连点间隔 100ms 发 3 次取流（原 debounce 只发 1 次）。`ended` 调换顺序没有收益（createRoot 下 effect 在微任务里才跑，submit/persist 仍在 doLoad 前同步执行）；「已存在条目删掉再插头部」没做也没记未做（子代理） | 首次点击立即加载、窗口内只保留最后一次、每次调度更新时间戳；ended 先快照会话再 reset、切歌、idle 时写快照（直接后推 persist 会读到被新 doLoad 清零的 listenedSec）；补「连点 5 次只取流 1 次」用例 |
| F11 | 3.10 | `hooks/useAudioEngine.ts:634,156` | 预解析失败就删 key、8s 后再试，整首歌期间无退避无负缓存：下一首是会员/denied 曲时每 8s 打一次插件；与用户操作共用频控额度，撞 rate-limited 让整个源退避 60s 反过来挡住用户切歌（推断）。`skipCache` 请求与旧在途同 key 时，旧请求结束会删掉新条目（子代理） | 每个 key 只试一次，遇 denied / rate-limited 放弃这首；`delete` 前比较 `inflightStreams.get(key) === request` |
| F12 | 2.1 | `pages/Playlists.tsx:96-98,213-219`；`pages/Artists.tsx` 页头；`pages/EmptyVsError.test.tsx` | 多源时任一源在加载就整页换成骨架，已返回的分节被盖掉（与该处「不等最慢的」注释矛盾，核实）；Artists 出错时页头仍显示「0 位」（子代理）。测试只渲染了两个组件，一页都没测 | 骨架只在分节内显示；页头计数在 isError 时也隐藏；每页一条 query-error 用例 |
| F13 | 2.7 | `services/errors.lint.test.ts:20-26,36,47`；`hooks/useAudioEngine.ts:775-786`；`api/adapters/plugin.ts:158`；`subsonic.ts:376` | lint 测试只扫 `.tsx`，点名的鸭子取码多在 `.ts`；正则只认一种写法；QrLogin、Search 整文件豁免过宽。useAudioEngine 的鸭子取码和 `description: detail`（原始 message）仍在；1.11 又新增两处鸭子取码（子代理） | 扫 `.ts/.tsx`，匹配 `\.message\b` 进 UI 的写法；按行豁免；清掉这 3 处 |
| F14 | 2.5 | `pages/Search.tsx:449`（`{g.name}：`）；`components/CommandPalette.tsx:223` | 全角冒号漏改一处（核实）；⌘K 面板 Enter 不判 `isComposing`（核实；WKWebView 拼音选字回车直接跳转为推断） | 走词条；加 `isComposing` / keyCode 229 判断 |
| F15 | 3.9 | `services/listeningHistory.ts:230-232` | 带 scope 的 `readListeningEvents` 每次 filter 出新数组，画像缓存按引用比对永远 miss，缓存实际不起作用（无正确性问题，子代理） | 缓存键改用 memoryCache 引用 + scope 字符串 |
| F16 | 3.4 | `frontend/vite.config.ts:437` | DECISIONS 说子集字体「走运行时缓存」，但 `runtimeCaching` 只有封面一条，离线 PWA 下这些字形回落系统字体（子代理） | 给 `-subset-` 字体加一条 CacheFirst |
| F17 | 3.1 | `hooks/useServerQueries.ts:490` | `enabled: hasAdapter()` 不是响应式；主库连上后 Home 能重拉只是碰巧经 `useRecommendationConstraints` 订阅了 servers（子代理，推断） | 订阅 `isConnected` 放进 enabled |
| F18 | 1.8 | `components/player/FullscreenPlayer.tsx:333-335` | 「加载失败」用了红色（红只给 destructive）；远程模板分支在远程未回来时就显示「无歌词」（推断，子代理） | 中性色；isLoading 合并两路 |
| F19 | 纪律 | `frontend/src/website/static.test.ts`；`docs/sources/PROGRESS.md` | 为迁就别人未提交的 website 改动，删掉了 A10（默认皮肤口径）、B13（词条整句）两组回归断言；PROGRESS 说「DECISIONS 已记」，实际没记（核实） | 不要删断言：在干净 worktree（`git worktree add`）跑门禁；恢复两组断言；补 DECISIONS |

### F-C · 测试质量

| # | 对应 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| F20 | 1.6 | `pages/History.clear.test.ts:15-33` | 测试自己重写了 scope 和循环再调 mock，完全没经过 `History.tsx`，属于自证（子代理） | 渲染页面、点清空、断言各源都被清 |
| F21 | 1.1 | `plugins/test/netease.playlist-write.test.mjs:31-32` | `assert.ok(true)` 空断言，没按 `hasMethod` 的路径探测（sandbox-call 间接覆盖到了，子代理） | 用 `collectMethodPaths` 断言 `n1ko.user.createPlaylist` 等三条存在、顶层 `user.*` 不存在 |
| F22 | — | 1.8 / 1.10 / 1.12 / 2.3 / 2.4 / 2.5 / 2.6 | 都没有回归测试（1.12 自己 grep 过，根节点 onKeyDown 已全判 target） | 各补一条 |
| F23 | 1.3 | `utils/detailPath.ts:5`；`SongList.tsx:693` 等 23 处 | 23 处都带了 `?src=`、功能没问题，但没统一走 `detailPath`，注释写「唯一拼法」不属实（子代理） | 替换掉这 23 处，或改注释 |
| F24 | 2.6 | `routes/lazyRoutes.tsx:49,62-81`；`hooks/useDocumentTitle.ts:34` | `/toplists` 列表页没进 `loaders` / `routeMatchers` 预取表，也没有标题映射（核实） | 补上 |
| F25 | 2.3 | `components/settings/SourcesSettings.tsx:337` | 只加了重入守卫，按钮本身没有 `disabled` / 忙碌态（子代理） | `disabled={updateBusy}` + 忙碌文案 |

### 复核方已改（随本复核一起提交）

- lint 四处：`SongList.tsx` 批量操作 memo 依赖改为 `primaryCaps`（并把 `useServerCapabilities()` 的第二次调用合并成一次）；`usePersonalizedRecommendations.ts` 补 `size`；`useServerCapabilities.ts` 的 methods memo 依赖改为 `[activeServerId, isConnected]`（并行连源后 setPrimary 不改 id，冷启动会卡在 NONE）并保留带理由的豁免；`fonts-subset.test.ts` 删无用 disable。
- `useServerCapabilities` 返回值按内容 memo：原来每次渲染都返回新对象，整个对象进依赖会让调用方逐帧重建（SongList 203 行的注释讲的就是这个）。
- `.gitattributes` 补 `*.bat text eol=crlf`：34dd4fc 把 `gradlew.bat` 归一成了 LF（PROGRESS 写「CRLF 保留」与提交内容相反），Gradle 原样分发 CRLF，LF-only 的 .bat 在部分 cmd 下 goto/label 出错；仓库内仍存 LF，checkout 时还原 CRLF。
