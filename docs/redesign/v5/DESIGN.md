# N1KO MUSIC v5 · 暖纸（Bloom）设计契约

> 真源永远是 `frontend/src/index.css` 的 token 块与 `frontend/tailwind.config.ts`。这份文档说的是怎么用它们。
> 2026-10-27 起，三张皮（奶油·软陶 / 糖果·波普 / 纸·墨·朱）收敛为这一套，只剩亮 / 暗两档。
> 方向由 Hallmark 发牌（Bloom，deal 3/3）后经 demo（`docs/redesign/v5/demo.html`）由用户选定。

## 一句话

暖白纸面、抬起的纸片、一盏陶土色。**封面是唯一的大面积色块**；界面本身靠纸片的高低和留白分区，不靠线。
签名部件：嵌在凹槽里的**橡胶播放键**（`.rubber-key`），歌词底下那张淡淡的**格纸**（`.paper-grid`）。

## 外壳（已完成，页面不要重复做）

布局只看**窗口宽度**（`useWindowClass`），不看设备：

| 档位 | 宽度 | 导航 | 典型设备 |
| --- | --- | --- | --- |
| compact | < 600 | 底部浮动标签栏 + 迷你播放条 | iPhone、Duo 外屏、iPad 侧拉 / 窄分屏 |
| regular | 600–1023 | 左侧导航条（QQ 音乐在 Duo 上的做法） | Duo 展开、iPad 竖屏、半屏分屏 |
| wide | ≥ 1024 | iPadOS 侧栏 + 右侧「正在播放」面板（≥1180 默认展开） | iPad 横屏、桌面 |

- 外壳提供：导航、吸顶工具栏（滚过页面大标题后浮现栏目名，铺纸色与模糊）、提示横幅、底部播放条、面板、队列抽屉、全屏播放器、快捷键表。
- 页面只负责 `<Outlet/>` 里的内容。页面容器已有 `max-w-[1240px]` 与左右内边距（16 / 24 / 32px），底部已为播放条留白。
  **页面里不要**：写 `h-screen` / `fixed` 顶栏、处理 safe-area、再放一个返回键或搜索框到顶部。
- 全屏播放器四种排法：stack（窄）/ portrait（竖着的大窗口）/ landscape（横着的窗口，左列控制右边歌词）/ tabletop（Duo 半折：折痕上歌词、下封面带与控制）。

## Token → Tailwind 类

| 角色 | 类 | 说明 |
| --- | --- | --- |
| 页面底 | `bg-paper` | 带 5% 纸面颗粒（body 上） |
| 下沉一档 | `bg-paper-deep` | hover 底、分组底、输入区底 |
| 再沉一档 | `bg-paper-3` | 选中底、进度轨 |
| 抬起的纸片 | `bg-sheet` | 卡片、面板、浮层；配 `shadow-card` |
| 主文字 / 次 / 说明 | `text-ink` / `text-ink-soft` / `text-ink-faint` | 说明与元信息一律 `ink-faint` |
| 线 | `border-hair` / `border-hair-soft` | 尽量不用：暖纸靠面不靠线 |
| 强调（陶土） | `text-primary` / `bg-primary` | **只给**：主操作、当前项（正在播放、选中）、状态。不给标题、不做装饰 |
| 危险（玫瑰） | `destructive` | 只给不可撤销的动作 |
| 状态 | `text-sem-playing` / `sem-fav` / `sem-connected` / `sem-error` | |
| 圆角 | `rounded-sm` 8 · `rounded-md` 12 · `rounded-lg` 18 · `rounded-pill` | 同一嵌套层级只用一种 |
| 投影 | `shadow-card` 卡片 · `shadow-press` 胶囊控件 · `shadow-float` 浮层与大封面 | |
| 字体 | `font-display` 标题 · `font-sans` 正文（同族 Schibsted Grotesk + 苹方） | `font-serif` 是旧名，改成 `font-display` |
| 衬线数字 | `font-figure`（Young Serif） | **全站只给一个大数字**（统计页的总时长那种），不进标题 |
| 数字对齐 | `num` | 时长、计数、序号 |

颜色 token 都是 oklch 三通道，`bg-ink/40` 这类不透明度修饰符处处有效。

## 现成的部件

- 组件类（`index.css`）：`.sheet`（抬起的纸片）、`.act-primary` / `.act-secondary` / `.act-icon`（页面动作三级）、`.section-head`（h2 + `.more`）、`.cover-tile`（可 hover 抬起的封面砖）、`.cover-slab`（大封面）、`.song-row`、`.seg-option.is-on`（分段控件当前项）、`.sticker`（小纸片标签）、`.press-pop`（按压手感）、`.glass`（浮层面）、`.rubber-key`（**只给播放主键**）、`.paper-grid`（**只给歌词与空状态的工作纸**）、`.scrollbar-hide`。
- React：`Button`（default / outline / secondary / ghost / link / icon）、`Input`、`Dialog`、`DropdownMenu`、`Slider`、`Tooltip`、`SongList`（右键菜单、拖动、多选都已做好）、`ImageWithFallback` / `CoverImage`、`EmptyState` / `ErrorState`、`UpNextList`。

## 版式

- **页面大标题**（iOS 的大标题）：`<h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">`，页面最上方；工具栏会在滚过 56px 后接替显示栏目名。
- **分区**：分区之间 `mt-10`（40px）；分区标题 `text-[21px] font-semibold`，右侧可选「全部」链接（`text-[14px] font-medium text-primary`），**不加箭头**。
- **断点**：用 `regular:`（≥600）与 `wide:`（≥1024），不要用 `sm` / `md` / `lg`（与外壳档位对不上）。
- **网格**：`grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-x-4 gap-y-6`；图片网格的轨道一律带 `min(100%, …)` 或 `minmax(0,1fr)`。
- **横向书架**：`flex gap-4 overflow-x-auto snap-x scrollbar-hide -mx-4 px-4 regular:-mx-6 regular:px-6 wide:-mx-8 wide:px-8`，卡片 `w-[148px] regular:w-[164px] wide:w-[176px] flex-none snap-start`。
- **专辑卡**：`cover-tile aspect-square` 封面 + 标题 14.5px 600 + 副标题 13px `ink-faint`。卡片里不再套卡片。
- **列表**：不画 `divide-y` 分隔线，靠行距与 hover 底（`hover:bg-paper-deep rounded-sm`）区分。
- **触控**：可点元素命中区 ≥ 44px（图标键 `h-10 w-10` / `h-11 w-11`）。不能只靠 hover 才看得见的操作——触屏常显，用 `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100` 只在有悬停的设备上隐藏。
- **iPadOS**：歌曲行右键（触控板双指点按）开行菜单、有触控板时可拖进「接下来」与侧栏歌单；按住 ⌘ 看快捷键表；⌃⌘S 侧栏、⌥⌘P 面板、⌘1/2/3 导航、⌘F 搜索、⌘L 歌词。

## Hallmark 底线（不可豁免）

1. 不写字面颜色（`#hex` / `rgb()` / `hsl()`）与 `font-family`，一律走 token。
2. 不用 `transition-all`；不动画 `width` / `height` / `top` / `left`，用 `transform` / `opacity`。
3. 标题里不出现单独一个斜体词。
4. 没有 eyebrow（标题上方的小标签）；标签、表头、导航不用大写加字距（不要 `uppercase`、`tracking-[0.xem]`）。
5. 不用中点「·」串元信息（「2020 · 15 首 · 1:23:04」）→ 改成 `flex flex-wrap gap-x-3` 的独立 span；链接文字不粘箭头；不要装饰性状态圆点。
6. 不用 emoji 当图标；图标只用 `@phosphor-icons/react`，激活态 `weight="fill"`。
7. 每个可交互元素有可见的 `:focus-visible`（全局已有，别用 `outline-none` 去掉而不补 `ring`）。
8. 动画要有 reduced-motion 兜底（全局已兜底；新动画加 `motion-reduce:animate-none`）。
9. 不编造任何数字、引言、文案。
10. 禁用态三条通道一起变：底色、文字色、指针，不只靠透明度。

## 旧体系的残留（见到就清）

`pop:` / `clay:` / `editorial:` 变体类（已不生效）、`font-serif`（→ `font-display`）、`tracking-[…em]` 字距、`uppercase`、`border-b border-ink` 下划线式按钮、`divide-y divide-hair` 列表、`rotate-*` 歪放的封面、`·` 中点串、`latin-tag`（「· FEATURED ALBUM」这类双语拉丁小标签：CSS 已隐藏，TSX 里删掉）、报头 / 刊号 / 书眉 / 版记这类杂志语汇。
