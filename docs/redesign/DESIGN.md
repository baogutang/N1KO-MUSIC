# N1KO MUSIC 重构设计规范（实施契约）

> 方向：「现代 Hi-Fi 音响器材」。深墨画布 + 祖母绿单一强调色 + 封面自适应氛围光。
> 参考实现：`docs/redesign/demo.html`（已获确认）。本文件是所有重构改动的唯一规范，任何页面不得偏离。

## 1. 色彩 Token（已在 index.css 落地，组件一律用语义类，禁止硬编码色值）

| 语义 | Tailwind 类 | 深色 | 浅色 |
|---|---|---|---|
| 画布 | `bg-background` | #0a0a0c | #f5f5f6 |
| 悬浮层 | `bg-card` / `bg-surface` | #121215 | #ffffff |
| 高亮层 | `bg-accent` / `bg-surface-hover` | #17171c | #ededef |
| 主文本 | `text-foreground` | #f2f1ed | #17171a |
| 次文本 | `text-muted-foreground` | #a1a09a | #66655f |
| 分隔线 | `border-border` | rgba(白 7%) 等效 | rgba(黑 8%) 等效 |
| 强调色 | `bg-primary` / `text-primary` | #2ec27e 祖母绿 | #157a4b |
| 强调色上的文字 | `text-primary-foreground` | 近黑墨绿 | 近白 |

规则：
- **全局唯一强调色**。爱心已收藏、播放中高亮、进度条、激活态一律 `primary`，禁止红/黄/蓝/紫并存（Stats 页的彩色图标全部收敛）。红色仅 `destructive`（删除/错误）。
- 会员/皇冠相关金色（amber）是唯一允许的第二色相，仅限会员标识，不得扩散。
- 禁止纯黑 `#000`、纯白文字 `#fff` 直接出现；一律走 token。
- 主题色切换功能保留（5 个预设已升级为高级版），组件端无感知。

## 2. 字体排印

- 界面字体：系统栈（不变）。
- **所有数字性内容（时间码、时长、播放次数、码率、统计数值、序号）加 `font-num` 类**（等宽 + tabular-nums）。这是本次设计的仪表感签名，不得遗漏。
- 页面主标题：`text-3xl font-bold tracking-tight`（32px/700/-2%）。
- 区块标题：`text-lg font-bold`（19px/700）。
- 首页问候语：`text-4xl font-bold tracking-tight`。
- 正文/列表 13.5–14px；次要信息一律 `text-muted-foreground`，不要用透明度调灰。
- 长 CJK 标题一律 `truncate`（单行省略），网格子项容器需 `min-w-0`。

## 3. 形状与层次

- 圆角三档：`rounded-lg`(12) 封面/卡片、`rounded-md`(10) 输入/小件、`rounded-full` 胶囊按钮/圆形控件。不引入其他档位。
- **去卡片化**：区块靠间距 + `border-t border-border` 分隔，不套一层 `bg-card` 盒子。仅悬浮元素（弹层、播放控制台、对话框）才有底色+边框。
- 封面图：`rounded-lg` + `ring-1 ring-border`（内描边），hover `-translate-y-1` + 阴影加深，hover 时右下角浮现绿色圆形播放按钮（38px，`bg-primary text-primary-foreground`）。
- 阴影仅用于封面和悬浮层，色调随背景（深色下黑，浅色下灰），禁止彩色 glow 滥用。
- 氛围光（glow）仅出现在：精选专辑封面后、播放控制台封面、全屏播放页封面后。颜色来自 `colorExtract` 提取的封面主色。

## 4. 关键组件规范

### 播放控制台（PlayerBar 重构为悬浮式）
- 不再贴边通栏：`absolute` 悬浮，左 = 侧边栏宽+8px、右 16px、下 16px，高 76px，`rounded-[20px]`、`border border-border`、`bg-card/75 backdrop-blur-2xl`、大阴影。
- 三段布局 grid `1fr auto 1fr`：左 = 封面48(氛围光晕)+歌名/歌手+爱心；中 = 传输键（shuffle/prev/**play 40px 绿色圆形**/next/repeat）+ 进度行（`font-num` 时间码 + 细进度条 3px，hover 出现 thumb）；右 = 歌词/队列/音量/全屏图标。
- 激活态（shuffle on / repeat on）图标用 `text-primary`。
- 内容区底部 padding 预留 120px 避免遮挡。

### 侧边栏
- 240px，画布同色（无独立底色），右侧 `border-r border-border`。
- 品牌区：绿色渐变方标(34px, rounded-[10px]) + N1KO MUSIC + 服务器名（前置 5px 绿点）。
- 导航项：`rounded-md`，默认 `text-muted-foreground`，hover 升 `text-foreground bg-surface`，激活 `bg-accent text-foreground` + 左侧 2px 绿色短竖条（`::before` 或绝对定位）。
- 分组标签（我的音乐）：11px `text-muted-foreground/70 tracking-widest`。
- 底部：会员 chip（amber 描边+淡底）+ 设置。

### 顶栏
- 高 60px，`border-b border-border`，无底色。前进/后退、搜索框（`bg-surface border-border rounded-md`，含 ⌘K kbd 提示）、右侧主题切换 + 头像。

### 全屏播放页
- 背景：封面模糊 90px + 深色 scrim；内容 max-w-[1360px]。
- 左列 440px：封面（大圆角 12、氛围光晕）→ 歌名 19px/700 + 歌手 + 爱心 → 进度行 → 大传输键（play 52px 绿色圆）。
- 右列：歌词流，当前行 `text-primary`（浅色主题用深绿）+ scale(1.05)，非当前行 `text-muted-foreground opacity-55`，26px/700，上下 22% 渐隐 mask，点击行可跳转。
- 顶部中央「正在播放」+ 歌名，左上收起按钮，右上更多。

### 列表行（SongList）
- 行 hover `bg-surface`；播放中行 `bg-primary/10`，标题 `text-primary`，行首放三条等宽均衡器动画（`playing-bar`，尊重 prefers-reduced-motion）。
- 时长/序号 `font-num text-muted-foreground`。

### 统计页
- 顶部 4 项统计：无卡片，`border-y border-border` 横条内 4 等分 + 竖分隔线，数值 `font-num text-3xl`。
- 柱状图：普通日 `bg-accent`，峰值日绿色渐变柱，数值标签 `font-num`。
- 榜单三列：无卡片，排名 `font-num`，封面 40px。

### 按钮
- 主按钮：`bg-primary text-primary-foreground rounded-full h-10 px-5 font-semibold`，hover 提亮，`active:scale-[0.97]`。
- 次按钮：`border border-border rounded-full`，hover 边框/文字升级为 primary。
- 图标按钮：32px `rounded-md`，hover `bg-accent`。

## 5. 图标（lucide-react → @phosphor-icons/react）

- 统一从 `@phosphor-icons/react` 导入；默认 weight="regular"，**激活/填充态用 weight="fill"**（爱心已藏、播放键、播放中图标）。
- 尺寸：导航/通用 18–20，传输键 20–22，play 图标 fill。
- 常用映射：Home→House, Search→MagnifyingGlass, Library→VinylRecord, Sparkles→Sparkle, Heart→Heart(fill 激活), Clock→ClockCounterClockwise, BarChart3→ChartBar, Settings→GearSix, Play→Play(fill), Pause→Pause(fill), SkipBack/SkipForward→SkipBack/SkipForward(fill), Shuffle→Shuffle, Repeat/Repeat1→Repeat/RepeatOnce, Volume2→SpeakerHigh, VolumeX→SpeakerX, ListMusic→Queue, Mic2→MicrophoneStage, Maximize2→ArrowsOutSimple, ChevronLeft/Right/Down→CaretLeft/Right/Down, MoreHorizontal→DotsThree, Plus→Plus, Trash2→Trash, Crown→CrownSimple(fill), X→X, Check→Check, Music→MusicNote, User→User, LogOut→SignOut, Wifi→WifiHigh, RefreshCw→ArrowsClockwise, Download→DownloadSimple, ExternalLink→ArrowSquareOut。
- 找不到对应图标时查 https://phosphoricons.com 命名，禁止手绘 SVG。整个文件迁移干净后，该文件不得再 import lucide-react。

## 6. 动效

- 统一缓动 `cubic-bezier(0.16,1,0.3,1)`；快 160ms（hover/按压）、中 280ms（面板、hover 浮现）、慢 480ms（全屏播放页进出）。
- 按压反馈：可点击元素 `active:scale-[0.97]`（图标按钮 0.94）。
- 页面进入：内容 `animate-fade-in`（已有 keyframes）。
- 所有循环动画（均衡器、氛围光呼吸）必须尊重 `prefers-reduced-motion`。
- 禁止：无意义的无限动画、彩色霓虹 glow、每个卡片都动。

## 7. 禁止事项（Pre-Flight）

- 不改信息架构、路由、文案语义、业务逻辑（本轮 bug 修复的逻辑不得被样式改动破坏）。
- 不引入新依赖（Phosphor 已装）。
- 不使用内联 style 写死颜色（氛围光的动态提色除外）。
- 不出现 em-dash（—）于任何 UI 文案。
- 空/加载/错误态必须保留且按新 token 上色；skeleton 用 `bg-accent animate-pulse`。
- 每个文件改完必须通过 `npx tsc --noEmit`。
