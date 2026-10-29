---
name: N1KO MUSIC
description: 舞台光（v6）——正在播放的那张封面是房间里的光；外壳是一台安静、精密的仪器。
colors:
  ground: "oklch(98.4% 0.004 255)"
  surface: "oklch(99.8% 0.002 255)"
  surface-2: "oklch(96.4% 0.006 255)"
  fill: "oklch(94.2% 0.007 255)"
  fill-2: "oklch(91.2% 0.009 255)"
  hair: "oklch(89.5% 0.007 255)"
  edge: "oklch(66% 0.012 262)"
  ink: "oklch(19% 0.016 262)"
  ink-2: "oklch(38% 0.016 262)"
  ink-3: "oklch(48% 0.014 262)"
  lime: "oklch(89.5% 0.2 127)"
  lime-deep: "oklch(85.5% 0.21 129)"
  lime-ink: "oklch(27% 0.07 134)"
  leaf: "oklch(47% 0.155 142)"
  leaf-deep: "oklch(42% 0.145 144)"
  danger: "oklch(53% 0.2 18)"
  ok: "oklch(52% 0.13 150)"
  warn: "oklch(74% 0.14 72)"
  ground-dark: "oklch(18.5% 0.009 262)"
  surface-dark: "oklch(23.2% 0.011 262)"
  ink-dark: "oklch(96.6% 0.005 262)"
typography:
  display:
    fontFamily: "Geologica, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'PingFang SC', sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: "1.05"
    letterSpacing: "-0.03em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', 'PingFang SC', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "22px"
rounded:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  pill: "999px"
  cover: "clamp(4px, 6%, 18px)"
components:
  button-primary:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.lime-ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.lime-deep}"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
  sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
---

# Design System: N1KO MUSIC（v6 舞台光）

> 本文依据已发布的代码写成：真源是 `frontend/src/index.css`（token）与 `frontend/tailwind.config.ts`（消费方式）。`index.css` 顶部带有 Hallmark 的 stamp / critique / waiver 注释，这里不转抄。机器可读的补充（阴影、动效、断点）在 `.impeccable/design.json`。

## Overview

**Creative North Star: "舞台光"**

正在播放的那首歌是房间里的光。封面的色相被取出来，经 `--art-*` 写进根元素，再由 `--wash*` 洒进整个外壳；光的亮度按主题锁死、饱和度封顶，所以任何封面下文字的对比都不变。外壳本身是一台安静的仪器：亮色是冷瓷白，暗色是石墨夜，中间没有装饰，靠留白和一个设备像素的线分区。

青柠只给「能按的、正在发生的」；叶绿是浅色下读得清的文字强调。Geologica 只做标题、大数字与字标，界面字走平台字体。浮在滚动内容之上的东西（标签栏、迷你条、工具栏）是玻璃胶囊，它们也在房间里，薄薄吃进一层封面的光。

动效是弹簧物理：跟手、带速度、随时可打断。一首歌是同一个物体，它在播放条、面板、全屏、队列之间移动变形，而不是各处一份副本。

**Key Characteristics:**
- 房间随歌变色；亮度锁死、饱和度封顶（对比恒定）。
- 两档地面（冷瓷白 / 石墨夜）+ 永远是暗场的 `.stage`。
- 青柠是填色、叶绿是文字，二者不混用。
- 全部按钮扁平：没有渐变、受光边、凹槽（PRODUCT.md 的品牌承诺）。
- 只有 `transform` / `opacity` / `clip-path` 在动。
- 吉祥物只陪在「没有内容」的时刻。

## Colors

颜色 token 全是 oklch 的三个通道（`L C H`），**不带 alpha**；`tailwind.config.ts` 用 `oklch(var(--x) / <alpha-value>)` 消费，所以 `bg-ink/40` 处处有效。数值以 frontmatter 为准（亮色档）；暗色档只在此列出差异。

### 中性（外壳）
- **ground** `--ground`：内容平面。暗色 `18.5% 0.009 262`。
- **surface** `--surface`：抬起的面（卡片、浮层、对话框）。暗色 `23.2% 0.011 262`。
- **surface-2** `--surface-2`：第二中性，承托侧栏、面板、分组底（实际用 `bg-surface-2/75`）。暗色 `20.6% 0.01 262`。
- **fill / fill-2**：hover 底、次级按钮 / 按下、选中、进度轨。暗色 `27% 0.013 262` / `31% 0.015 262`。
- **hair**（`--hair-soft` 为 `92.5% 0.006 255`）：一个设备像素的线。暗色 `29.5% 0.013 262`。
- **edge**：输入框描边，对地面 3:1（index.css 注释）。暗色 `50% 0.014 262`。
- **ink / ink-2 / ink-3**：墨。亮色注释的对比度为 17.6:1 / 9.6:1 / 6.2:1；`ink-3` 用于说明与元信息，「光最浓处仍 4.5:1」。暗色 `96.6% 0.005 262` / `81% 0.011 262` / `70% 0.013 262`。

### 品牌（四个角色，不要混）
- **lime** `--lime`（暗色同值）：**只做填色**，且只给一屏唯一的主操作、播放键（`.play-key`）、进度、当前项（`.song-row.is-current` 底为 `lime / 0.22`，暗色 `/ 0.12`）。`--lime-deep`（hover / 按下；暗色 `92.5% 0.18 125`）。
- **lime-ink** `--lime-ink`：青柠上的字与图标，注释对比 11:1（暗色 `24% 0.06 134`）。
- **leaf** `--leaf`：**文字强调**色（链接、`.section-head .more`、当前曲名、开关按下、焦点环），注释对比 6.1:1，光最浓处仍 4.4:1。暗色档 `--leaf` 直接等于 `--lime`。
- **on-solid**：叶绿 / 危险色实底上的浅色字。
- 状态：`danger`、`ok`、`warn`（暗色各自抬亮）；`candy-*-soft` 是三色的浅底。来源徽标用 `--src-1..5` 五个小圆点（`.src-chip`），不用作界面强调。

**The Fill-Or-Text Rule.** 青柠是面，叶绿是字。不要把 `text-lime` 用在浅色地面上，不要把 `bg-leaf` 当主按钮底。

**The Quiet Heart Rule.** 收藏（心）平时是墨色（`--sem-fav: var(--ink)`），叶绿只在点赞那一下闪（`HeartGlyph` 的 `animate-heart-pop` / `animate-heart-ring`）。`aria-pressed` 的开关类（随机、循环、队列）按下是叶绿，收藏不算「当前」。

### 房间的光
- `--art-h` / `--art-c` / `--art-h2` / `--art-c2`：由 `services/artLight.ts` 的 `applyPalette` 写在根元素；默认「场灯」是 `127 / 0.12 / 158 / 0.08`（即 `HOUSE_LIGHTS`）。主色相取饱和度 `c` 夹在 0.03–0.2，副色相与主色至少相隔 40°，`c2` 夹在 0.03–0.18；近乎黑白的封面标 `neutral`，`c` 退到 0.012。
- 派生：`--wash = --wash-l min(--art-c, --wash-cap) --art-h`；`--wash-2` 取副色相；`--wash-strong = --wash-l2 min(--art-c, --wash-cap2) --art-h`。
- 封顶：亮色 `--wash-l: 92%`、`--wash-cap: 0.1`、`--wash-l2: 86%`、`--wash-cap2: 0.12`；暗色 `30% / 0.1 / 25% / 0.11`。
- 舞台 token：`--stage 27% min(c, 0.09)`、`--stage-2 22% min(c2, 0.08)`、`--stage-deep 14% 0.02`、`--stage-ink 97% 0.006`。

### `.stage`（全屏播放器）
永远是灯暗下来的那一档，与亮暗主题无关。`.stage` 在自己这一层**重新声明**所有中性 token 与旧别名（引用型 token 在 `:root` 上就解析掉了，不重写则里面拿到的还是外壳的亮色值）：`--ground 21% 0.03`、`--surface 28% 0.035`、`--fill 33%`、`--ink 97% 0.006`、`--ink-3 76% 0.016`，色相全是 `var(--art-h)`；`--leaf` 取 `--lime`；`--glass-tint: 0`、`--glass-alpha: 0.46`。`.stage-fallback` 是没有 WebGL 时的两团固定径向光。

**The Locked-Lightness Rule.** 封面只能决定色相与（封顶的）饱和度，永远不能决定亮度。任何组件里不出现字面颜色；颜色只在 `index.css` 的 token 块里写字面值。

## Typography

**Display：** Geologica（自托管可变字重 300–800，`src/styles/fonts.css`，西里尔与越南语子集带 `-subset-` 不进 SW 预缓存），用于页面标题、分区标题、大数字、字标、空态标题。`font-display`（别名 `font-serif` / `font-figure`）。
**UI / Body：** 平台字（`-apple-system`、`SF Pro Text`、`Segoe UI Variable Text`……），中文走 PingFang SC / 微软雅黑 UI 等（`--font-cjk`）。`font-sans` / `font-ui` / `font-mono` 都指向它。
**基线：** `body` 15px / 1.5，`antialiased`，`h1–h3` 用 `text-wrap: balance`，`p` 用 `pretty`。

### 字号刻度（`tailwind.config.ts` fontSize，px / 行高）
- `micro` 11/14 · `caption` 12/16 · `meta` 13/18 · `small` 14/20 · `body` 15/22
- `title-sm` 17/22（−0.01em）· `title` 20/26（−0.015em）· `headline` 26/30（−0.02em）
- `page` 34/38（−0.025em）· `page-wide` 44/48（−0.03em）· `hero` 56/58（−0.035em）
- 页面标题实际写法：`font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] regular:text-[44px]`（Home、Library）。
- `.section-head h2`：Geologica 650，22px（窄窗口 20px），行高 1.15，−0.02em。`--display-weight: 650`、`--display-tracking: -0.025em`。
- 空态标题：Geologica 20px / 600；说明 14px，`ink-3`，最长 34em。

### 数字
需要对齐的数字一律 `.num` / `.font-num`（`tabular-nums`）；大数字用 `.font-figure`（Geologica 600，−0.03em，等宽数字）。时间、计数、统计都走这两个类。

**The Plain-Label Rule.** 没有加字距的大写字母，没有 eyebrow / kicker。分区靠留白和 Geologica 标题，`.section-head h2 small` 与 `.latin-tag` 被明确隐藏（`display: none`）。

## Layout

窗口宽度分三档，不按设备；Tailwind 断点只有两个：`regular:` ≥600px、`wide:` ≥1024px（`useWindowClass` 与之一致）。

- **compact <600**：底部玻璃标签栏（`TabBar`，`.glass rounded-pill p-1.5`）+ 迷你播放条胶囊。
- **regular 600–1023**：侧边导航条 `AppRail`（宽 84px，圆角 24px，`bg-surface-2/75`）。
- **wide ≥1024**：浮动侧栏 `AppSidebar`（`minmax(244px, 272px)`，圆角 22px）+ 右侧「正在播放」面板 `NowPlayingPanel`（`minmax(312px, 356px)`，圆角 22px）。
- `MainLayout` 是三列 grid：`leftColumn | minmax(0, 1fr) | rightColumn`，单行；内容区 `max-w-[1240px]`，水平内边距 `px-4 / regular:px-6 / wide:px-8`，并尊重 `env(safe-area-inset-*)`。最底下铺 `ArtWash`（高 `96vh`）。
- 播放条浮在内容与面板之上（`z-40`），底部有一层 `from-ground` 渐隐；窄窗口两侧留 8px。
- 整个应用是一块固定框架（`html, body { position: fixed; overscroll-behavior: none }`），内容只在主区里滚。

### 页面模式
- **页面标题**（Geologica，见上）→ **`.section-head`**（标题 + 右侧 `.more`，上内边距 36px、下 16px）→ 内容。
- **`CoverShelf`**：横向书架，`snap-x snap-mandatory`，卡片 `snap-start`，宽 148 / 164 / 180px（compact / regular / wide），触屏直接滑，有鼠标时两端出翻页键。
- **`CoverGrid`**：`grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))]`，`gap-x-5 gap-y-7`。
- **`DetailHero`**（专辑、歌单、歌手、榜单、单曲）：封面在上（窄）/ 左封面右文字（宽），头部铺本封面自己的 `ArtWash`；滚动 0→320px 时封面缩到 0.84、透明度到 0.35，文字上移 24px，光到 0.25（0→420px）。
- **歌曲行 `.song-row`**：`px-3 py-2`，`gap-4`，圆角 `--r-sm`，hover 铺 `fill / 0.8`，不位移。

### 全屏播放器的四种排法（`FullscreenPlayer.tsx` 的 `Layout`）
- `stack`（compact）：封面 / 歌词 / 接下来三选一，下面是进度与控制，下拉收起。
- `portrait`（竖着的大窗口）：上封面配控制，下歌词或接下来。
- `landscape`：左列是操作的东西，右边一直摆着歌词。
- `tabletop`（Duo 半折，`useDevicePosture`）：折痕以上歌词，以下封面带与控制。

## Elevation & Depth

混合：地面靠中性层级抬升（暗色里面越抬越亮），浮层靠墨色带偏移的投影，浮在滚动内容之上的靠玻璃。线是一个设备像素：`--hairline: 1px`，`min-resolution: 2dppx` 时 `0.5px`（`.hairline-b` / `.hairline-t`）。

### 阴影词汇（亮色；暗色同结构，阴影色换 `--shade: 6% 0.01 262` 且透明度更高）
- `--shadow-sm`：`0 1px 2px shade/0.06, 0 1px 1px shade/0.04`（`.sheet`、`.seg-pill`、`.cover-tile` 静止态）
- `--shadow-md`：`0 2px 4px shade/0.05, 0 12px 28px -12px shade/0.2`（`shadow-card`、进度拇指）
- `--shadow-lg`：`0 4px 12px shade/0.06, 0 28px 60px -20px shade/0.3`（`.glass`、`shadow-float`）
- `--shadow-cover`：`0 2px 6px shade/0.1, 0 20px 44px -18px shade/0.38`（大封面 `.cover-slab`、`.cover-tile` hover）
- `--ring-hair`：`inset 0 0 0 0.5px ink/0.09`，贴着面的极细内描边（`shadow-hair`）。

### 玻璃 `.glass`
只给浮在滚动内容之上的东西：标签栏、迷你条、工具栏、弹出层。底是 `surface / --glass-alpha`（亮 0.74，暗 0.68，舞台 0.46），上面叠一层 `wash / --glass-tint`（0.3 / 0.32 / 舞台 0），`backdrop-filter: blur(26px) saturate(1.7)`，阴影为 `shadow-lg + ring-hair + inset 0 1px 0 wash-strong / --glass-edge`（上沿一道封面色的亮边，亮 0.7、暗 0.5、舞台 0.22）。不支持 backdrop-filter 时退成实心 `surface`。`.scroll-edge` 是工具栏的滚动边缘：内容滚到底下才铺 `ground / glass-alpha` 的玻璃与一条发线。

**The No-Card-In-Card Rule.** 一层面就是一层面：`.sheet`（`surface`、`--r-lg`、`shadow-sm + ring-hair`）里不再套第二块带边带影的卡。分组靠留白、`surface-2` 的底、或发线。空态的「列表本该在这里」是下沉一档的 `bg-ink/[0.035]`，不画边不画格。

**The Hairline Rule.** 分隔线一律一个设备像素，用 `inset box-shadow` 或 `--hair`，不用 `border` 叠 `border`。

## Shapes

- 半径刻度：`xs 6` · `sm 10` · `md 14` · `lg 20` · `xl 28` · `pill 999`（`--radius` 默认 `--r-md`）。
- **封面圆角随尺寸走**：`--r-cover: clamp(4px, 6%, 18px)`，缩略图 4px，大封面 18px。封面框 `.cover-frame`：`overflow: hidden; isolation: isolate`，`::after` 一圈 `0.5px ink/0.1` 内描边，把封面和任何底色分开。歌手语境用圆形（`round`）。
- 按钮、分段控件、标签栏、图标按钮都是胶囊（`rounded-pill`）；播放条按档位 `22px / 22px / 24px / 26px` 圆角的玻璃胶囊（compact 60–62px 高、regular 70px、wide 86px）。
- 侧栏 / 导航条 / 面板圆角 22–24px；侧栏导航项 12px。
- 来源徽标是 8px 圆点（`.src-chip`）；`.sticker` 小标签 `--r-sm`。

## Components

### 按钮（`ui/button.tsx` 与 `.act-*`）
- 全部是胶囊，扁平，由 `.press-pop` 给手感。
- **primary / default**：`bg-lime text-lime-ink`，hover `lime-deep`，高 44px（`h-11 px-5 text-[15px]`；`.act-primary` 为 `min-height: 44px; padding: 0 24px`）。**一屏只有一个。**
- **secondary / outline**：`bg-fill text-ink`，hover `fill-2`；`.act-secondary` `0 20px`。
- **ghost / icon**：平时不占面，hover 铺 `fill`；`.act-icon` 为 44px 圆，`.is-on` 时叶绿字。
- **destructive**：`bg-danger text-on-solid`。**link**：`text-leaf`，hover 下划线。
- 尺寸：`sm h-9`、`lg h-12 px-7`、`icon h-10 w-10`、`icon-sm h-9`、`icon-lg h-12`。禁用态三条通道一起变：底色（`fill`）、文字（`ink-3`）、指针（`not-allowed`），`opacity: 0.6`。
- 焦点环走全局 `:focus-visible`：`2px solid leaf`，`outline-offset: 2px`，立即出现，不淡入。

### 播放键 `.play-key`（签名部件）
实心青柠圆键，扁平。按下 `scale(0.92)`，松手按 `--ease-press` 带弹性回来。播放三角**不要手动右移**，Phosphor 的 Play 已按重心居中。`:focus-visible` 的 offset 为 3px。

### 分段控件
`.seg-pill`（`motion` 的 `layoutId` 滑块）亮色是抬起的白片（`surface + shadow-sm + ring-hair`），暗色是 `fill-2`，`.stage` 里是 `ink / 0.16`。`.seg-option.is-on` 同理。

### 导航
标签栏 / 侧栏 / 导航条的当前项是一块会滑的 `bg-ink/[0.08]`（标签栏）或 `[0.075]`（侧栏、导航条）胶囊（`layoutId`），不是青柠。标签栏项 `min-h-[52px]`，11px 半粗体。

### 封面卡 `CoverCard`
外层 `role=button` + `tabIndex` + Enter/Space；封面砖 `.cover-tile`（hover 上抬 3px 并换 `shadow-cover`，仅在 `(hover: hover)`；按下 `scale(0.98)`）；图注两行（标题、计数 / 歌手）。点进详情时用 `rememberCoverOrigin` 记下位置。

### 骨架与缓冲
`.skeleton` 是一道很淡的光从左扫到右（`shimmer 1.6s linear infinite`）；缓冲时主键 `animate-buffering`（透明度 1↔0.55，1.1s）。正在播放的均衡器三连柱 `.playing-bar` 只动 `scaleY`。

### 空态、错误、加载（`EmptyState` / `ErrorState` / `LoadingState`）
标题是一句完整的话（Geologica 20px/600）；说明句只写下一步，没有下一步就不写；行动是一枚中性胶囊（`Button variant="secondary"`），不是实心青柠——页头已经有这一屏唯一的强调色。`ruled` 铺下沉的 `bg-ink/[0.035]` `rounded-lg` 面（`py-12`），否则 `py-16`。加载态不放吉祥物，字号与位置同空态，以免切换时版面跳。

### 吉祥物（`common/Mascot.tsx`）
角色是**糯米**（白兔，黄背带裤）和**毛豆**（绿青蛙，红白条纹 T 恤，青柠耳机）。角色版权归作者 N1KO（绘本《糯米和毛豆》）。图是 Codex 出的渲染原图（原图与提示词在 `docs/redesign/v6/mascots/`），本机用 `cutout.py` 抠成透明底（ISNet 抠图 → 补实白毛 / 眼白被误抠的半透明 → 去底色污染 → 只留脚边真实的落地阴影），成图是 `frontend/public/mascots/*.webp`。眨眼帧（`*-blink.webp`）只含眼睛那几块，和原图同尺寸、叠在上面用。

（v1.14.0 前试过在 Blender 里把两只做成可摆姿势的 3D 模型，和 Codex 原图并排比，差距明显，用户决定不用 3D，吉祥物一律用原图。）

| 姿势 | 用在哪 |
|---|---|
| `nuomi-wink`（眨眼的糯米） | `EmptyState` 默认（空收藏等） |
| `nuomi-sleep`（睡着的糯米） | 安静、没东西：LinerNotes、QueueDrawer、TopLists、TopListDetail |
| `maodou-listen`（戴耳机） | 「听了才会有」：History、Stats、Recommendations、TasteProfile |
| `maodou-wave`（招手） | 「去搜一搜 / 去连接」：Search、Library、Albums、Artists |
| `maodou-surprised`（吃惊） | 出错与找不到：`ErrorState`、SongDetail、Playlists、Search |
| `duo-wave`（两只一起招手） | 登录欢迎页（Login，260px，宽屏 `min(38vw,460px)`）与开屏（追光扫进来 → 两只跳上来落地扬尘 → 蹦两下、音符和星光 → 一起眨眼 → 字标 → 开洞收场，约 2 秒，点一下就跳过） |

只出现在**没有内容可看**的时刻：欢迎、空列表、没有结果、出错、开屏。从不压在工作内容或可操作元素上。它是装饰：`alt=""`、`aria-hidden`，话都在旁边的文字里；不想要就传 `mascot={false}`。默认 128px。动效很轻：待机 `animate-breathe`（3.2s），有眨眼帧的（`duo-wave`、`maodou-wave`）每 4.8s 叠一张闭眼图只亮约 120ms（`animate-mascot-blink`，`steps(1, end)`），hover 歪头 −3°；减弱动态效果时全部停在静帧。

### 不做拟物的 3D（v1.14.0 的决定）
v6 一度在全屏播放器里放过一张可切换的 three.js 悬浮黑胶（打光、反射、纹路高光）。用户看过成品后的判断是「太过拟物，和整套扁平的界面不是一个世界」，于是整块删掉，`three` 依赖一并移除。想要唱片感时用设置里的**圆形封面**（`coverShape: 'circle'`）：一张扁平的圆形封面随播放慢慢转（`animate-spin-vinyl`，24 秒一圈——真唱片的 1.8 秒一圈放在界面上像在快进；暂停即停），不打光、不做反射。往后任何「3D」都要先过这一条：材质感只属于吉祥物，界面本身保持扁平。

### 舞台光场（`player/StageField.tsx`）
全屏背景：四盏柔光（取自封面最多 4 个色块，光的亮度限在 0.36–0.5，增益 0.74 / 0.58 / 0.48 / 0.4）在暗场里慢慢游走。画布只有显示尺寸的 1/4，30fps（扩散期间满帧），页面隐藏就停。**换歌时新颜色从封面所在位置向外漫开**：新旧两组光源都在着色器里，用半径 0→铺满的圆做分界，持续 1500ms，缓动为 `1 − (1 − k)³`。减弱动态效果只在换歌时画一帧静止的光。没有 WebGL 退回 `.stage-fallback`。

### 当前封面（`CurrentCover`）与横屏卡片叠（`CardStage` / `CardStack`）
正在播放页的封面区只放正在放的这一张：左甩下一首、右甩上一首（位移 > 宽度的 26% 或速度 > 700；越过阈值 `haptic('light')`；没甩够弹回去，每张封面的拖动位移各管各的）。切歌时，下一首是旧封面往左飞走、新封面在原位从 0.9 长出来；上一首是上一张从左边飞回来、旧的在原位缩回去。封面里的图片不接指针（`[&_img]:pointer-events-none`）：不然鼠标按住图片一拖就触发浏览器原生的「拖拽图片」，整次甩动被取消（v1.15.0 以前桌面上用鼠标甩不动就是这个原因）；iPad 上长按也不再弹「存储图像」。**后面不再叠接下来的两张**（v1.15.0，用户：「不是要所有的封面排在后边儿」）——正在播放页只回答「现在放的是什么」；叠牌拿掉以后，窄屏上封面最多 88cqh（原来给后面两张露边留出的位置还给封面）。

挑下一首是另一件事，**横过来**做：iPad、手机横屏时，正在播放整页换成**卡片叠**（v1.16.0；v1.15 那排挂在控制区下面的「接下来 / 歌单…」按钮被用户否了：「这种肯定不行」）。设置「横屏卡片模式」（`playerCardMode`）三档：自动（默认：原生壳或主指针是粗的，且窗口横着、至少 560px 高）、总是（电脑上的横屏窗口也用）、关闭。竖屏、窄窗口、Duo 半折照旧，正在播放页不挂任何「去挑歌」的入口。

卡片叠的样子照 iPhone 的多任务界面、**左右镜像**：焦点那张最大最亮、略偏左（左边缘在 `(宽 − 边长)/2 − 0.2 边长`）；后面的叠在它右边、压在它底下（`z-index` 随序号减），越往后露得越少（第一张露 0.46 个边长，往后约每张 ×0.6）、越小（以右边缘为原点，最多缩到 0.82）、越暗（每张 +16% 深色蒙版，封顶 55%），最深处停在 0.9 个边长；前一张在左边、压在焦点上面，间距 1.08 个边长（不挡焦点那张）、露出一截、压暗 30%，再往前的已经出了屏幕。边长 = min(高 × 0.86, 宽 × 0.4, 620)。位置用连续的 `p`（以「张」为单位），离焦点 u 张的那张：u < 0 匀速（x = 1.08u），u ≥ 0 是两段指数之和 `A(1 − e^(−αu)) + B(1 − e^(−βu))`，在 0 处斜率接上 1.08（经过焦点时速度不突变，见 `cardPose`）。每帧直接写 `transform` / 蒙版透明度 / 焦点与 aria 属性，不经 React；焦点变了才把说明文字和挂载范围交给 React（`startTransition`）；只挂焦点左 3 张、右 8 张。压暗蒙版（`.card-veil`）和播放键常驻自己的合成层：每帧改透明度不必连图带影子重画整张卡。卡片投一道往右的影子落在被压住的那张上（`.card-stack-shadow`）。焦点那张右下角一枚青柠播放键，正在放的那张换成右上角的「正在播放」角标（叠里的卡露出来的是右边那一截），换焦点时淡入。

**为什么后面的叠在右边（v1.16.1）**：v1.16.0 是叠在左边、下一张从右边进来，用户在 iPad 上：「滑动不跟手啊，也不丝滑」。卡片叠两侧不一样快——散开的一侧匀速，叠着的一侧越往里挪得越少——手指只能和其中一侧同速。最常用的一划是「下一张」（往左）：叠在左边时，这一划是把手里那张往叠里压，那张卡只走手指一半的路，右边进来的那张却快一倍多；镜像以后，这一划是焦点那张往散开的一侧走（与手指同速）、下一张从叠里抽出来。iPhone 上最常用的一划（往回翻）也是把卡从叠里抽出来。

手感：按住跟手——拖 1.08 个边长（= 左边的间距）算一张，焦点那张和左边那张与手指严格同速；两头拉过头有橡皮筋（最多再多 0.35 张）。松手按最后 100ms 的速度往前甩：落点 = p + 速度 × 0.5 秒，取整到最近一张；甩了（速度 ≥ 0.35 张 / 秒）就至少翻到甩的方向上的下一张（离某张不到 0.15 张算已在它上面），和系统分页一样，轻轻一扫不会又吸回原处。然后用**临界阻尼弹簧**带着松手时的速度滑过去——角频率 ω = clamp(2.5|v|/|d|, 下限, 13)：ω ≥ |v|/|d| 不冲过头，2.5 倍让松手后最多快出 7.5%、换来收得利落；下限按距离给（一两张内 8，更远 5），没甩用 11、速度背离目标用 13。飞得快（> 0.6 张 / 秒）时按下去是接住、不算点；慢下来以后点上去的就是看见的那张。触控板 / 滚轮跟着滚、停下 140ms 后吸附；←→ / Home / End 一张张走，回车播放焦点那张，焦点环画在焦点那张卡上（不画在整条叠上）。点焦点那张 = 播放，点别的 = 挪到中间。减弱动态效果时吸附是瞬时的。

**帧率**：WKWebView 默认把网页的渲染更新压在 60 次 / 秒（WebKit 的 `PreferPageRenderingUpdatesNear60FPSEnabled`，App 里没有公开开关，WebKit bug 294338），iPad Pro 的屏是 120Hz：原生滚动和系统动画 120 帧、网页里逐帧算的拖动和弹簧只有 60 帧。iOS 壳在 `AppViewController.webViewConfiguration` 里经 WebKit 私有接口关掉这一项（找不到就什么也不做，退回 60 帧），Info.plist 加 `CADisableMinimumFrameDurationOnPhone`（iPhone Pro 要它才给 120Hz）。相应地，常驻的逐帧循环不能每帧都要一帧：光场 30fps 改成隔 30ms 才 `requestAnimationFrame`，不把屏幕拴在最高刷新率上。

分栏（顶栏中间的分段标签，带图标）：接下来 / 推荐 / 专辑 / 歌单 / 收藏。「接下来」按播放顺序排：放过的在左边（露出刚放完的那张）、正在放的在焦点、后面的叠在右边，换歌时自己跟过去；推荐 = 为你推荐页同一份（`useMergedRecommendations`，交错去重、最多 60 首）；专辑 = 最近播放（新库退回最新入库）；歌单 = 各音源 `useSourcePlaylists`；收藏 = 各音源收藏的歌。每栏只在看它时取数据，各自记得翻到哪儿，挂上时先停在正在放的那张（有的话）。底下是一条「正在播放」：小封面 + 歌名（点它回到「接下来」）、控制 + 进度、加歌单 / 收藏——它说的永远是正在放的那首，和焦点那张分开。转屏换排法时内容淡进来。

### 开屏（`common/Splash.tsx`）
约 2 秒（`setTimeout 2050`），一场小演出，时间线写在 `index.css` 的开屏一节：**开灯**（青柠与叶绿两团柔光开出来，`splash-bloom` 1.6s，之后缓慢漂移；两束追光 `.splash-beam` 从上角竖直往下、扫到朝向舞台中央 ±32°，0.9s，停住后 ±4° 轻晃——锥形渐变 + 往下淡出的遮罩）→ **登场**（`duo-wave` 从下面跳上来：`splash-hop` 0.9s，往上冲时拉长、到顶复原、往下加速，0.71s 落地压扁 `scale(1.08, 0.9)` 再回弹；落地同时脚下四团烟尘 `splash-puff` 往两边散开）→ **演出**（落地后跟着拍子再蹦两下 `splash-bop`；毛豆耳机里飘出五个 Phosphor 音符，各走各的路线；糯米耳朵和爪子边闪三下 `Sparkle` 星光；1.76s 叠上闭眼帧 `duo-wave-blink`，两只一起眨一下眼）→ **字标**（N 1 K O 落地后逐字升起，每字错开 0.06s；底下一道 3px 青柠线从左划到右）→ **收场**（角色与字标先朝镜头冲出去、`scale 1.12` 淡掉，0.34s；追光淡出；随后以中心为原点用 `mask-image` 径向渐变开一个洞，`--splash-hole` 从 −14% 到 116%，0.72s，App 从洞里扩散出来）。音符和星光用叶绿（浅色底上青柠看不见；深色主题里叶绿就是亮青柠）。开发时 `?splash-t=毫秒`（可加 `&splash-theme=dark`）把开屏定格在那一刻，逐帧检查编排。
跳过规则：同一次会话只播一遍（`sessionStorage` 的 `n1ko-splash-seen`）；`MODE === 'test'` 或 `navigator.webdriver` 不播；点一下或按任意键提前收场；减弱动态效果时只留 320ms 后的短淡出。App 在它下面照常挂载，不挡启动；整块对读屏隐藏。

## Motion（动效）

只有 `transform` / `opacity` / `clip-path`（以及遮罩的自定义属性）在动。`transition-all` 从不使用，用命名的属性列表。

### 弹簧（`lib/motion.ts`，单一真源）
- `SPRING_SNAPPY`：stiffness 520 / damping 44 / mass 1。界面状态（滑动的当前项、分段、开关、曲名翻页）。
- `SPRING_PRESS`：420 / 26 / 1。手势松开后的回弹，带一点过冲，**只给手指拖过的东西**。
- `SPRING_SMOOTH`：260 / 30 / 1。布局与浮层，不过冲。
- `SPRING_GENTLE`：170 / 24 / 1。大面板、全屏。
- `SPRING_MORPH`：300 / 32 / 1。共享元素（封面从迷你条飞到全屏、从卡片飞到详情）。
- `EASE_OUT = [0.16, 1, 0.3, 1]`；`rubberBand(offset, limit)` 做边界橡皮筋。

### CSS 缓动与时长（`index.css`）
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`；`--ease-in: cubic-bezier(0.55, 0, 0.75, 0.3)`。
- `--ease-press` / `--ease-snappy` / `--ease-smooth`：临界阻尼弹簧采样成 `linear()`（界面状态不过冲；手势的回弹在 `lib/motion` 里按物理算）。
- 时长：`--dur-1` 90 · `-2` 160 · `-3` 240 · `-4` 360 · `-5` 520 · `--dur-press` 460ms（Tailwind 的 `duration-1..5`、`duration-press`）。
- 浮层入场用 `--ease-snappy`，退场更快：`dialog-in 0.36s / out 0.14s`、`menu-in 0.3s / out 0.12s`、`toast-in 0.42s / out 0.16s`、`sheet-in 0.45s / out 0.22s`。

### 具名动效
- **press-pop**：按下 90ms 收到 `scale(0.96)`，松手 460ms 按弹簧回来（`.play-key` 为 0.92，`.cover-tile` 按下 0.98）。
- **layoutId 滑块**：导航当前项、`.seg-pill`，`SPRING_SNAPPY`。
- **卡片 → 详情的共享封面**：`rememberCoverOrigin` / `takeCoverOrigin`（`lib/sharedCover`）；`DetailHero` 挂载时先摆到卡片位置，再以 `SPRING_MORPH` 弹回，落地前垫卡片已加载的小图。
- **迷你条 → 舞台（FLIP）**：封面带 `data-np-anchor`，播放条带 `data-np-bar`。**只动 opacity / transform，整串 `transform` 交给 WAAPI（motion 把弹簧转成 `linear()`）跑在合成器上**：背景（光场那一层）0.28s 淡入（`EASE_OUT`）；封面以 `SPRING_MORPH` 从迷你条飞来，飞行全程是实的（`CoverImage` 对本次会话加载过的地址不再淡入，打开前还会预先下载并解码当前这首的大封面）；其余元素 `data-fs-reveal` 依次上浮 18px（延迟 `0.12 + i × 0.035`s，`SPRING_SMOOTH`）；开场落定（最多 900ms）才点亮光场的 WebGL，期间是同色的 `.stage-fallback`，画好第一帧后淡入盖上。收起原路飞回，落到迷你条那一下淡掉，背景 0.3s 淡出。全屏播放器的代码在有歌时趁空闲预先拉下来，第一次点开不等下载、不闪 Suspense 的暗场。（v1.14 以前用 `clip-path` 从播放条撑开：WebKit 不合成 clip-path 动画，每帧整屏重绘，iPad 上一顿一顿，已弃用。）
- **封面甩动**：见 `CurrentCover`；按钮切歌与自动播完走同一套，方向读 `lib/skipDirection`（上一首 / 右甩为 −1，其余 +1，记号 2 秒内有效）。
- **吸附书架**：`snap-x snap-mandatory`；抽屉吸附到档位给 `haptic('selection')`。
- **卡片叠**：见「横屏卡片叠」——焦点那张与手指严格同速、按速度投影落点（× 0.5s，甩了至少翻一张）、临界阻尼弹簧带着初速度吸附到整数张，不回弹；纯函数 `cardPose` / `flingTarget` / `springOmega` 有测试。
- **惯性滚轮（`useWheelInertia`）**：只接管「一格一格跳」的离散鼠标滚轮（`deltaMode` 为行，或 `wheelDeltaY` 是 120 的整数倍）；每帧追 20% 的距离；触控板与 Magic Mouse 不接管（系统自带惯性）；落在嵌套滚动元素、按着 Ctrl / Shift、`pointer: fine` 不满足、减弱动态效果时一律交还浏览器；按下指针或键盘即停。
- **扩散转场（View Transitions）**：`lib/viewTransition.ts` 的 `radialReveal`，用于从开关处切亮暗：以点击点为圆心 `clip-path: circle(0 → r)`，620ms，`cubic-bezier(0.16, 1, 0.3, 1)`；`html[data-vt='reveal']` 关掉默认的交叉淡化。不支持或减弱动态效果时直接切换。
- **房间换色**：`ArtWash` 渐变不能插值，所以叠一层新的并 `wash-in`（1.1s）淡入，再拿掉旧的，只动 `opacity`。
- **光场扩散**：见上，1500ms。
- **心跳**：`heart-pop`（0.6 → 1.28 → 1，0.5s）与 `heart-ring`（0.6s）**只在状态变化时**播放，初次渲染时不播。
- **曲目信息落定**：`page-turn`（`translateY(6px)` → 0，0.36s）。路由切换 `route-in` 0.28s 纯淡入。
- **触感（`lib/haptics.ts`）**：仅原生壳，网页与桌面壳空操作；只给「确认发生了」的瞬间——播放 / 暂停、切歌、收藏、甩封面越阈值、抽屉吸档。

### 减弱动态效果
全局兜底把所有 `animation-duration` / `transition-duration` 压到 `0.01ms`；空间位移退成淡入淡出，但确认类反馈（颜色、透明度的状态变化）保留。均衡器停在 `scaleY(0.6)`，骨架、缓冲、圆形封面自转、吉祥物呼吸与眨眼关掉；全屏开合退成 0.2s / 0.15s 的淡入淡出；惯性滚轮、扩散转场、光场游走都不运行。

## Do's and Don'ts

### Do:
- **Do** 让封面只决定色相，亮度和饱和上限留给 `--wash-*` / `--stage-*`；新增依赖光的面，用 `wash` / `wash-strong` token，别自己拼。
- **Do** 青柠只给一屏唯一的主操作、播放键、进度、当前项；文字强调用 `text-leaf`。
- **Do** 新颜色先进 `index.css` 的 token 块（oklch 三通道，不带 alpha），再进 `tailwind.config.ts`；字面颜色只能出现在 token 块里。
- **Do** 在 `.stage` 这类重新声明了 token 的作用域里用语义类（`text-ink`、`bg-surface`），不要引用只在 `:root` 解析的别名。
- **Do** 保持 `:focus-visible` 可见（`2px` 叶绿环），不要给它加淡入。
- **Do** 触控目标 ≥44px（视觉小于它的用 `before:-inset-*` 或胶囊内边距补足）。
- **Do** 长中文标题截断、容器配 `min-w-0`；中西文混排用 `spaceCJK`；数字用 `.num`。
- **Do** 浮在滚动内容之上才用 `.glass`；封面一律包 `.cover-frame`。
- **Do** 新特性（View Transitions、WebGL、滚动驱动动画）渐进增强，并写减弱动态效果的退路。
- **Do** 手势松开的回弹用 `SPRING_PRESS`，界面状态用 `SPRING_SNAPPY` / `SPRING_SMOOTH`。

### Don't:
- **Don't** 做拟物按钮：橡胶键、渐变、受光边、凹槽。播放三角不要手动偏移。
- **Don't** 用 `transition-all`，也不要动画 `width` / `height` / `top` / `left` 等触发布局的属性。
- **Don't** 让祖先带 `opacity < 1` 包着玻璃（毛玻璃会失效）；遮罩只动底色（`overlay-in`）。
- **Don't** 在任何位置用大写加字距的标签、eyebrow、kicker。
- **Don't** 把吉祥物放进工作内容、列表中间或可操作元素上；也不要在加载态用。
- **Don't** 用 `text-lime` 写浅色地面上的文字，或用 `bg-leaf` 做主按钮底。
- **Don't** 在 `.sheet` / 卡片里再套卡片。
- **Don't** 依赖悬停才看得见的操作；`hover` 样式放进 `@media (hover: hover)`。
- **Don't** 按设备分叉布局；只用 `regular:` / `wide:` 两个窗口断点。
- **Don't** 用 Tailwind 的 `duration-[…]` 任意值（会与 `tailwindcss-animate` 撞车而不生成），用命名档 `duration-1..5` / `duration-press`。
- **Don't** 引入除 `@phosphor-icons/react` 以外的图标。

## 文件地图

| 部分 | 路径 |
|---|---|
| token、玻璃、`.act-*`、`.cover-*`、`.song-row`、`.play-key`、`.stage`、开屏关键帧 | `frontend/src/index.css` |
| 颜色 / 字号 / 半径 / 阴影 / 层级 / 缓动 / 动画 | `frontend/tailwind.config.ts` |
| 字体注册（Geologica 自托管） | `frontend/src/styles/fonts.css`、`frontend/public/fonts/` |
| 弹簧、橡皮筋 | `frontend/src/lib/motion.ts` |
| 扩散转场 | `frontend/src/lib/viewTransition.ts` |
| 触感 | `frontend/src/lib/haptics.ts` |
| 惯性滚轮 | `frontend/src/hooks/useWheelInertia.ts` |
| 封面取色 → `--art-*` | `frontend/src/services/artLight.ts`、`frontend/src/store/artLightStore` |
| 房间的光（壳底、详情头） | `frontend/src/components/art/ArtWash.tsx` |
| 舞台光场（WebGL，径向扩散） | `frontend/src/components/player/StageField.tsx` |
| 当前封面 / 横屏卡片叠 | `frontend/src/components/player/CurrentCover.tsx`、`frontend/src/components/player/CardStage.tsx`、`frontend/src/components/player/CardStack.tsx` |
| 全屏播放器（四种排法、FLIP 开合） | `frontend/src/components/player/FullscreenPlayer.tsx`（外壳 `FullscreenPlayerOverlay.tsx`） |
| 播放条 | `frontend/src/components/layout/PlayerBar.tsx` |
| 壳（三列 grid、侧栏、导航条、标签栏、面板） | `frontend/src/components/layout/{MainLayout,AppSidebar,AppRail,TabBar,NowPlayingPanel}.tsx` |
| 吉祥物 / 图 | `frontend/src/components/common/Mascot.tsx`、`frontend/public/mascots/`、`docs/redesign/v6/mascots/` |
| 开屏 | `frontend/src/components/common/Splash.tsx` |
| 空态 / 错误 / 加载 | `frontend/src/components/common/{EmptyState,ErrorState}.tsx` |
| 详情头、封面卡 / 书架 / 网格 | `frontend/src/components/common/{DetailHero,CoverCard}.tsx` |
| 按钮 | `frontend/src/components/ui/button.tsx` |
| 方向合同 / 产品真相 | `.impeccable/surfaces/frontend-src.md`、`PRODUCT.md` |

本文取代 `docs/redesign/v5/DESIGN.md`（后者保留作历史，不再维护）。
