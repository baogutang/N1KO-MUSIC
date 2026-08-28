# N1KO MUSIC · 设计契约 v2 —— 杂志编辑风（Editorial）

> 状态：**仍然有效，但不再是默认皮肤**（2026-08-28 起）。
> 自 v3 起本应用有两张皮：默认的「糖果·波普工坊」见 `docs/redesign/v3/DESIGN.md`，
> 本文件描述的「纸·墨·朱」降级为可选皮肤，在设置 · 外观里选、或点工具条的调色板图标切换。
> 本文件对该皮肤的一切约定继续生效，改这张皮时仍以本文件为准。
>
> 参考实现：`docs/redesign/v2/demo-editorial.html`（已批准的静态 demo）。
> 更旧的契约 `docs/redesign/DESIGN.md`（现代 Hi-Fi 器材风）作废，仅作历史留档。
>
> 注意：v3 引入了形状 / 字体 / 动效 token 层（`--stroke`、`--r-*`、`--shadow-*`、
> `--display-weight`），本文件里写死的 1px 发丝线、4/6/8px 圆角、宋体标题
> 现在都由这层 token 在 `:root` / `.dark` 上给出——值没变，来源变了。

## 0. 第一性原理

这是一个**个人音乐收藏客户端**，不是流媒体商店。用户的三件事：马上放点什么、逛自己的收藏、沉浸在正在播放里。
因此设计语言是「一本可播放的音乐杂志」：

- **文字即界面**。排版、发丝线、留白承担全部结构职责；消灭卡片、消灭阴影堆叠、消灭 pill 按钮。
- **封面即内容**。封面是唯一允许的大面积色块，其余保持纸面克制。
- **数字是数据**。一切时长、序号、码率、数量用等宽字体 + tabular-nums。
- **浅色为主**。米白纸面为默认主题，深色为同气质变体，不是简单的反色。

## 1. 色彩

### 1.1 浅色（默认）

| Token | 值 | 用途 |
|---|---|---|
| `--paper` | `#f4efe3` | 页面底色 |
| `--paper-deep` | `#ece5d4` | 分区沉底、hover 底、播放条底 |
| `--ink` | `#1d1a15` | 主文字 |
| `--ink-soft` | `#5c564a` | 次级文字 |
| `--ink-faint` | `#8d8676` | 辅助/说明文字、序号 |
| `--hair` | `rgba(29,26,21,.22)` | 主发丝线（报头双线的 3px double 也用它） |
| `--hair-soft` | `rgba(29,26,21,.12)` | 次级发丝线（列表行分隔） |
| `--accent` | `#b8442a` | 唯一强调色：朱红（当前播放、hover、当前歌词、链接下划线 hover） |
| `--accent-deep` | `#9c3520` | 强调色按压态 |

HSL 近似值（写入 `index.css` 的 shadcn token 时用）：
paper `43 36% 92%`，paper-deep `41 32% 88%`，ink `36 14% 10%`，ink-soft `38 10% 33%`，
ink-faint `40 9% 51%`，accent `11 62% 44%`，accent-deep `13 66% 37%`。

### 1.2 深色（变体，非默认）

| Token | 值 |
|---|---|
| `--paper` | `#1a1712` |
| `--paper-deep` | `#221e17` |
| `--ink` | `#ece5d4` |
| `--ink-soft` | `#a89f8c` |
| `--ink-faint` | `#6e6759` |
| `--hair` | `rgba(236,229,212,.20)` |
| `--hair-soft` | `rgba(236,229,212,.10)` |
| `--accent` | `#d9603f` |
| `--accent-deep` | `#b8442a` |

### 1.3 规则

- 强调色只有一个。禁止再出现绿色播放键、多彩 accent 预设（设置里的「强调色」选项随重构移除）。
- 纸面有极轻噪点纹理（demo `body{background-image}` 的 feTurbulence data-URI，直接搬）。
- 选中色 `::selection{background:rgba(184,68,42,.18)}`（深色模式同步调）。
- 禁止投影堆层次。唯一允许的投影：大封面/浮层下的极淡单侧投影 `0 1px 2px rgba(29,26,21,.06), 0 8px 24px rgba(29,26,21,.08)`。
- 封面以外的渐变只允许一种：封面取色晕染（正在播放页背景），浅色模式下晕染不透明度 ≤ 0.35。

## 2. 字体排印

### 2.1 字族（自托管，见 `src/styles/fonts.css` + `public/fonts/`）

```css
--font-serif: "Source Serif 4","Noto Serif SC","Songti SC","STSong","SimSun",serif;   /* ≈ Tiempos */
--font-sans:  "Hanken Grotesk","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; /* ≈ Styrene */
--font-mono:  "JetBrains Mono","SF Mono",ui-monospace,Menlo,Consolas,monospace;
```

中文部分由系统宋体/黑体接管（macOS: Songti SC / PingFang SC），拉丁与数字由自托管字体接管。

### 2.2 用法

- **衬线（serif）**：一切内容名——歌名、专辑名、歌手名、页面大标题、歌词、推荐语。曲名 600、专辑/页面标题 700–900。
- **无衬线（sans）**：界面骨架——导航、标签、按钮、表单、设置正文。正文 15px/1.7。
- **等宽（mono）**：一切数字与元数据——时长、序号（01–10）、日期、数量、码率、时间码。`font-variant-numeric: tabular-nums`。
- 标签文字（11–12px）：`letter-spacing: .14em–.3em`，可用全大写拉丁或中文加宽字距，颜色 `--ink-soft`/`--ink-faint`。
- 大标题（≥30px）：`letter-spacing: -.01em`，`text-wrap: balance`。
- 行宽：编辑文案段落 ≤ 34em。

## 3. 布局骨架

桌面窗口 1280×800（最小 900×600），不再有左侧常驻 sidebar：

```
┌──────────────────────────────────────────────┐
│ 顶部工具条（h≈44px）：返回层级 / 搜索 ⌘K / 主题 / 用户 │
│ 报头 masthead：N1KO MUSIC · 期号/日期 · 服务器状态     │ ← 下缘 3px double 发丝线
│ 主导航（文字链接行）：首页 音乐库 歌手 歌单 推荐 …       │ ← 当前项下缘 2px accent 短划线
├──────────────────────────────────────────────┤
│ 内容区 max-width:1180px，左右 padding 40px          │
├──────────────────────────────────────────────┤
│ 底部播放条（h≈72px，非浮空）：小封面+曲名(serif) │ 时间码+传输键 │ 音量/队列/全屏 │ ← 上缘 1px 发丝线
└──────────────────────────────────────────────┘
```

- 导航当前页：accent 色 + 下方 2px 短划线（不是背景块）。
- 分区标题范式：`最近添加  RECENTLY ADDED ……（右侧）全部 1,024 首 →`，标题衬线 30px/700 + 拉丁小标签 wide-tracking，上缘 1px 发丝线。
- 列表即网格：曲目一律用编号列表（序号 mono + 小封面 + 衬线曲名 + 歌手 + mono 时长，行间 hair-soft，hover 整行底色 paper-deep + 右移 4–6px + 浮现细线圆播放键）。**禁止卡片网格**（专辑封面墙除外，见下）。
- 专辑封面墙允许存在（封面即内容）：等比网格、无卡片边框，图注为衬线专辑名 + 小字歌手，hover 封面微放大（scale 1.03，300ms）。
- 内容区纵向节奏：区块间距 56–72px；发丝线 + 留白代替卡片。

## 4. 组件范式

### 4.1 按钮（三级，全部无背景块）
- **主操作**：纯文字 `▶ 播放整张专辑`，sans 600，发丝下划线，hover 变 accent 且下划线变 accent。
- **次操作**：细线圆角小钮（1px hair 边框、radius 4–6px、padding 6px 14px），hover 边框变 ink。
- **图标键**（传输/音量等）：32px 细线圆或纯图标，hover 出 1px 圆环/变 accent；`:active{transform:scale(.95)}`。
- 播放主键可以是唯一例外：实心 accent 圆（仅底部播放条与正在播放页各一处）。

### 4.2 播放条（底部）
demo 底部条范式：左 = 52px 封面 + 衬线曲名 + 小字歌手；中 = mono 时间码 `01:36 / 04:12` + 五个传输键；右 = 音量细滑杆、队列、全屏、「正在播放 →」。上缘 1px hair，背景 paper 或 paper-deep。空态：「选择一首歌曲开始播放」（ink-faint）。

### 4.3 正在播放（全屏页）
纸张底 + 可选封面取色淡晕染；左大封面（max 440px，圆角 6px，淡投影）；右歌词流——衬线 20px、过去行 ink-faint、当前行 ink 700 + 前导 accent 短红线、未来行 ink-soft；顶部「收起 / 正在播放 · 曲名 / ⋯」。歌词点击 seek、3 秒手动滚动锁等现有行为**全部保留**。

### 4.4 表单与设置
- 输入框：无卡片，下缘 1px hair，focus 时下缘变 accent（2px 过渡），标签为小号 wide-tracking。
- 设置页：分区用「衬线分区标题 + 发丝线」，选项行式排布（左说明右控件），开关用细线滑块。
- 对话框：纸面底、1px hair 边框、radius 8px、无重投影；标题衬线。

### 4.5 状态
- loading：骨架 = hair-soft 底色的行/块闪烁（不用 spinner，除极小场景）。
- 空态：衬线一句人话 + ink-faint 说明 + 一个文字级主操作。如「这一页还是空白。去音乐库挑一张专辑 ▶」。
- 错误：直接陈述，不用「哎呀」「Oops」。「连接失败。请检查服务器地址后重试。」
- focus-visible：`outline:2px solid var(--accent); outline-offset:3px`。

## 5. 动效

- 统一缓动 `--ease: cubic-bezier(.16,1,.3,1)`；hover/进出 200–300ms；视图切换 fade+translateY(10px) 350–500ms。
- 只用 transform/opacity 动画。当前播放行保留 EQ 三竖条动画（accent 色）。
- `prefers-reduced-motion` 时全部动画关闭。

## 6. 不要清单（违者返工）

- 不要卡片 + 阴影 + 圆角 12px 的通用卡片盒；不要 pill 按钮；不要左侧常驻 sidebar。
- 不要绿色/蓝色/紫色 accent；不要玻璃拟态；不要渐变按钮。
- 不要把拉丁字体设为 Inter/Roboto；不要中文用粗黑体大标题（用衬线）。
- 不要 emoji 当图标（沿用 Phosphor 图标，stroke 统一）。
- 不要破坏任何现有功能与数据逻辑（adapter / audio engine / stores / hooks 一律不改，仅改消费它们的 UI）。

## 7. 工程约定

- Token 落在 `frontend/src/index.css`（CSS 变量 + Tailwind 语义映射），字体在 `src/styles/fonts.css`（已就绪）。
- 现有 shadcn 风格组件（`components/ui/*`）按需改造样式而非重写 API。
- 所有文案 zh-CN；README/注释遵循仓库现有惯例。
- 每完成一个阶段必须 `npx tsc --noEmit` 与 `npm run build` 通过。
