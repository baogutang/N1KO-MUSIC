# 2026-10-10 整改分支复审 · 必修清单

> 对 `fix/audit-2026-10-10` 上 3b9f3a8…60e1de9 的 17 个提交做的只读复审。门禁全绿（lint / tsc / 前端 845 / 后端 26 / 插件 40 / 构建）。
> 下面按「必修 → 应修 → 顺延」排。file:line 以 60e1de9 为准。执行纪律同 `docs/audit-2026-10-10.md` 第 0 节：每条修完加能抓住原问题的测试；门禁全绿才提交；不 push。

## A. 必修（回归或在真实环境必错）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| A1 | `frontend/src/hooks/useKeyboardShortcuts.ts:42-68`、`components/player/QueueDrawer.tsx:80` | 全屏播放器改成 `role="dialog"` 后被 `isDialogOpen()` 命中：全屏时空格、←/→、⌘←/→、s/r/m、⇧C 全部失效。回归。 | 外壳加 `data-fullscreen-player`，两处选择器 `[role="dialog"]:not([data-fullscreen-player])`；补测试「全屏下 Space 仍切播放」。 |
| A2 | `frontend/src/services/recommendationFilters.ts:53`、`utils/songIdentity.ts:74` | `normalizedSet(mutedArtists)` 先把「A / B」抹成「ab」再喂 `artistBlockedBy`，分隔符没了，集合匹配失效（node 复现）。旧实现能挡的现在挡不住。单测传的是原始条目所以是绿的。 | 去掉预归一，`artistBlockedBy` 内部自己拆分并再比一次整串 key；补一条**经 `applyRecommendationConstraints`** 的用例（屏蔽 A，候选 artist 为 "A / B"）。 |
| A3 | `frontend/src/components/music/TasteProfile.tsx:144`、`store/tasteStore.ts` | 画像 key 从 lower 改成 `normalizeText` 后，已持久化的旧屏蔽键 `includes` 不再命中：过滤仍生效，界面显示「未屏蔽」，点一下只加新键，再点只删新键，无法解除。 | tasteStore 加 persist migrate 把旧键重归一；或 `isMuted` 两侧归一后再比。补迁移测试。 |
| A4 | `backend/src/routes/notes.ts:156` | `storedUpdatedAt = updatedAt ?? now` 原样采信客户端时钟且无上限（zod 到 2100 年）。快钟设备写一次，其它设备对这条边注全部 409 直到真实时间追上，客户端还会采信服务端而丢掉本地新编辑。 | `storedUpdatedAt = Math.min(updatedAt ?? now, now + 300)`，冲突比较用同一值；补「快钟 1 天」用例。 |
| A5 | `frontend/src/hooks/useAudioEngine.ts:1166,1649` | 单曲循环倒带只复位了 `playSubmitted` 与看门狗；`listenedSec`、`listenedPrevT`、闭包里的 `scrobbleAttempts`/`scrobbleRetryAt` 没清。第 2 遍起落盘时长累计、scrobble 在每遍开头立刻触发、循环 5 遍后 scrobble 永久停摆。 | `onRepeatRewind` 里全部清零；补引擎级用例。 |
| A6 | `frontend/src/components/common/CoverCard.tsx:63`、`pages/Playlists.tsx:243,295` | 根节点 `onKeyDown` 不判 `e.target`：内层播放键、DropdownMenu 菜单项按 Enter/Space 冒泡上来被 `preventDefault` 后直接跳转。 | 开头 `if (e.target !== e.currentTarget) return`。 |
| A7 | `frontend/src/components/sources/QrLogin.tsx:75` | `startQr` 把共享的 `cancelledRef` 置 false，快速切换 QQ/微信时晚到的旧 `createQr` 仍能覆盖 key 与图：显示微信码却轮询 QQ 的 key。 | 自增 requestId，回调时比对。 |
| A8 | `plugins/qqmusic/index.js:208,224-232,395` | ① 刷新后凭据整体由响应重建，响应缺 openid/refresh_token/musicid 时写成空串、uin 变 "undefined"，第二次刷新缺料。② 到期前 10 分钟窗口内刷新失败（含断网、限流、QQ 扫码凭据本就无 refresh_token）一律抛 unauthorized，旧 key 其实还有效，整个插件被挡、横幅误报重登。 | ① 与旧凭据合并（响应优先）。② 主动刷新失败用旧 key 继续；被动刷新只把鉴权类错误映射成 unauthorized，network/rate-limited 原样抛。各补用例（响应只有 musickey/refresh_key；刷新 network 错误不致 unauthorized）。升 qqmusic patch + catalog。 |
| A9 | `frontend/src/hooks/useAudioEngine.ts:1607` | 播放 effect「死元素就重载」判据太宽：暂停态点歌或冷启动首播时 load effect 刚清空 src，这里也命中，多 bump 一次 playVersion、重复取流（插件源多撞一次限频）。另 `unsupported` 被当瞬态暂停会卡住队列。 | halt 分支设模块级 `needsReloadOnPlay` 标记，播放 effect 仅在标记为真时重载，`doLoad` 开头清掉；`unsupported` 归入 not-found 一类（换源/跳歌）。 |
| A10 | `README.md:54`、`README_CN.md:53`、`website/index.html:63`、`website/script.js:19,90` | 默认皮写成「糖果·波普」。`themeStore.ts:43` `DEFAULT_SKIN = 'clay'`。旧 README 本来是对的，本次改错。 | 默认改回「奶油·软陶」，顺序按 SKINS：clay、pop、editorial；皮肤名与 UI 词条一致（去掉「工坊/Workshop」）。 |
| A11 | `website/assets/fonts/fonts.css:6-90` | `url('assets/fonts/X.woff2')` 相对 css 自身解析，13 个字体全部 404。 | 改成 `url('X.woff2')`。 |
| A12 | `README.md:35-37`、`README_CN.md:35-37` | N1KO-API 推广区块文案被改写（删了「订阅转 API 中转平台」与导语）。第 0 节明令不动。 | 还原 main 上的原文（`git show main:README_CN.md`）。 |

## B. 应修（功能缺口或承诺不实，本轮一起做）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| B1 | `frontend/src/hooks/useSourceQueries.ts:371`、`components/sources/SourceShelves.tsx:129` | 1.5 只对主库推荐做了渲染端过滤；插件源每日推荐 queryKey 无屏蔽指纹，屏蔽后 10 分钟内仍出现。 | 合并前对 sourceGroups 的 data 调 `filterRecommendable`，依赖屏蔽指纹；补测试。 |
| B2 | `frontend/src/services/recommendationEngine.ts:116` | 负侧固定除以 3、正侧按 `positiveMax` 相对归一，尺度不一致：重度用户（头部歌手原始权重≈20）新歌手一次 completed ≈ +0.1、一次 skip ≈ -0.104，不满足「≤ 一半」。 | 负侧也除以 `max(positiveMax, 常数)` 或给单次 skip 设上限；加重度历史用例。 |
| B3 | `frontend/src/services/recommendationEngine.ts:199` | 种子 id「最新赢」写反：events 是新到旧，逐条 set 让最旧的赢；测试用旧到新喂数据掩盖了。 | 只在该源还没有 id 时写入；测试改成新到旧。 |
| B4 | `frontend/src/components/layout/PlayerBar.tsx:337`、`player/FullscreenPlayer.tsx:584,735`、`player/CarMode.tsx:157`、`pages/AlbumDetail.tsx:140` | F10 后 star 可选挂载，但这几处心形没按 `caps.favorites` 判断：点了先变红再回滚，插件专辑直接抛错。 | 与 SongList 一致按 `caps.favorites` 隐藏；专辑页只对声明专辑收藏的源显示。 |
| B5 | `frontend/src/hooks/useAudioEngine.ts:1474` | `cleanup` 在 reattach 与音质切换时也发 Jellyfin `stop`，`nowPlayingSent` 不复位也不再发 `start`，会话中途被关；暂停后恢复没有上报。 | 只在真切歌路径发 stop；恢复播放补上报。 |
| B6 | `frontend/src/api/adapters/jellyfin.ts:480` | `deleteBookmark` 仍直打 `/UserItems`，Emby 404（6.4 漏一处）。 | 改走 `postUserData` 双路由。 |
| B7 | `frontend/src/utils/lrc.ts:47-55` | `[offset:]` 只对其后的行生效，旧两套都是全局应用。 | 先扫一遍取 offset 再解析；补用例。 |
| B8 | `frontend/src/utils/songIdentity.ts:49` | 先 split 后 NFKC：全角 ＆ ， ／ 和「A (feat. B)」不拆。 | split 前 `normalize('NFKC')`；补括号 feat 形态。 |
| B9 | `frontend/src/api/syncClient.ts:209` | 新客户端每次 PUT 带 `updatedAt`，老后端 zod `.strict()` 直接 400，边注静默推不上。 | 遇 400 去掉 updatedAt 重试一次；DECISIONS 写明最低后端版本。 |
| B10 | `backend/src/app.ts:35`、`routes/auth.ts:148` | XFF 警告每个请求都打；`TRUST_PROXY_HOPS=0` 反代后 `req.ip` 是代理地址，「账号+IP」退化成按账号锁。 | 警告加一次性标记并在启动时提示；README-TODO 记「反代必须设 TRUST_PROXY_HOPS」。 |
| B11 | `frontend/src/components/sources/SourceGroupState.tsx:72` | 频控倒计时只在渲染时算一次、无定时器、到期不自动重试，文案却写「自动恢复」；`rateLimitedSeconds` 零引用。 | 加 1s tick，到期 invalidate。 |
| B12 | `frontend/src/components/player/FullscreenPlayerOverlay.tsx:72` | Radix Content 无 Title/Description，开发态每次打开 console.error。 | 视觉隐藏的 Title + `aria-describedby={undefined}`。 |
| B13 | `website/script.js:24,95`（`sources.note`）、`index.html:262` | 语言切换把整段替换成半句；下载区 HTML 默认文案无 xattr 引导，切语言后才出现。 | 词条补全整句；HTML 与词条一致。 |
| B14 | 两份 README 音源表、`README.md:214,348,353` | QQ 行写了「收藏」（manifest 无 favorites 能力）；英文漏「微信」；同步章节写 `local-playlist`（前端零调用）、架构图 favourites 双向（实为只推不拉）；英文里出现中文设置路径「跨设备同步」。 | 逐处改正；「你的音乐只去你的服务器」一行改写为含插件音源的表述。 |
| B15 | `plugins/qqmusic/index.js`、`plugins/netease/index.js:305`、`frontend/src/api/adapters/plugin.ts:176` | F13 的 AbortSignal 只是赛跑没透传到 hostFetch；并发后 `ensureAnonymousCookie` 无 single-flight，冷启动并发注册 4 次。 | 加 single-flight；signal 透传到 host.call 可后续。 |
| B16 | 测试缺口 | `plugins/test/harness.mjs:143` 的 setCredentials 会改 env.credentials（真沙箱不会），删掉 liveCredentials 测试照绿；`netease.uid.test.mjs:25` 没调 currentUid；`songIdentity.test.ts:101` 冻结测试没钉字面量；subsonic offset 符号、jellyfin NaN、hostFetch 协议降级剥凭据都无用例。 | 逐条补会失败的用例。 |

## C. 顺延（记进 DECISIONS，不阻塞合并）

- `useAudioEngine.ts:777` denied 含 unauthorized 会白发 3 次降档取流（只对 forbidden 降档）；`:595` 清 preloadEl 后 `preloadedIdRef` 没复位。
- `scripts/check-plugin-versions.mjs:49` 只判 manifest 被改过不比 version；push 只看 HEAD^。
- `storageMaintenance.ts:163` rebuildable 未含 musicbrainz 缓存（8.5 未达成）。
- `UpdatePrompt.tsx:29` 只是不再注册 SW，没注销已有注册。
- `hostFetch.ts` sameHost 比 origin：http→https 升级与换端口也剥凭据（偏严，可接受）。
- `listeningStats.ts:89`、`recommendationEngine.ts:161`、`issue.ts:150` 仍用 `isQualifiedListeningEvent`，F15 只收敛一半。
- `QrLogin.tsx:248` `pop:not-first:*` 变体不存在（无输出）；`ConnectionBanner.tsx:333` 三元两支相同；Favorites/Playlists/Search 遇 unauthorized 未走 auth 态。
- 官网：画廊 player 图说明写「柠檬黄荧光笔」但 gif 是软陶；`applyLang` 不刷新 alt；`og:image` 需绝对 URL。
- 合入 main 前需在仓库 Settings 把 Pages Source 设为 GitHub Actions，否则 pages.yml 首发失败。
- DECISIONS 阶段 1 零条目：1.8 翻页用 offset 而非 cursor、客户端未真正采服务端时钟，应补记。
