# N1KO MUSIC · 设计契约 v3 —— 糖果·波普工坊（Candy Pop Workshop）

> 状态：已获用户确认（2026-08-28），已落地。
> 参考实现：`docs/redesign/v3/demo-pop.html`（已批准的交互原型，可在两张皮之间来回切）。
> 与 v2 的关系：**并存，不作废**。`docs/redesign/v2/DESIGN.md`（纸·墨·朱）继续有效，
> 降级为可选皮肤；本文件描述的糖果·波普是**默认皮肤**。

## 0. 第一性原理

这是一个**个人音乐收藏客户端**。v2 定下的信息架构（报头 / 刊号 / 封面故事 / 书眉 / 版记 /
编号列表 / 封面墙 / docked 播放条）**一律不动**——皮肤换的是语气，不是骨架。

糖果·波普换掉的是「纸」这个隐喻，换成「工坊」：

- **实体感代替留白**。层次由 2px 墨描边 + 零模糊硬投影制造，不由发丝线和空白制造。
- **颜色即语义**。四支糖果色各自绑死一个含义，绝不挪用、绝不当装饰。
- **一切可按**。按钮是胶囊，按下去真的位移、投影缩短，像按一个实体键。
- **平涂**。没有渐变、没有毛玻璃、没有柔和阴影。v2 唯一允许的那道封面取色晕染，
  在这张皮里关掉。

## 1. 色彩

### 1.1 浅色（默认）

| Token | 值 | 用途 | 对比度 |
|---|---|---|---|
| `--paper` | `#fbf1e3` | 奶油页面底 | — |
| `--paper-deep` | `#f1e4ce` | 沉底 / hover 底 | — |
| `--surface` | `#fffbf3` | 卡面（比页面亮一档） | — |
| `--ink` | `#1b1a19` | 描边 + 主文字 | 15.6:1 |
| `--ink-soft` | `#56514a` | 次级文字 | 7.9:1 |
| `--ink-faint` | `#6e675e` | 辅助文字、序号 | 5.0:1 |
| `--hair` | `#1b1a19`（alpha 1） | 描边色。波普的「发丝线」不是发丝，是实心墨 | — |
| `--hair-soft` | `rgba(27,26,25,.18)` | 列表行分隔 | — |

### 1.2 糖果色的语义绑定（本设计的核心约束）

| 色 | Token | 语义 | 对比度 |
|---|---|---|---|
| 葡萄紫 `#4f46e5` | `--accent` | **正在播放 / 当前项 / 主操作** | 5.6:1 |
| 薄荷绿 `#14713f` / 填充 `#5bbe7b` | `--candy-ok` | **已连接 / 成功 / 在线** | 5.4:1（深绿用于文字） |
| 柠檬黄 `#f0c63c` | `--candy-warn-fill` | **收藏 / 星标 / 当前歌词** | **只做底，永不做文字** |
| 珊瑚红 `#c23217` / 填充 `#e8705a` | `--candy-danger` | **断开 / 删除 / 错误** | 5.0:1（深红用于文字） |

每支糖果色都有「深色档（文字安全）」与「浅色档（只做底）」两个值。规则：

- **浅糖果色永远不写字。** 浅绿 / 浅黄 / 浅粉在奶油底上只有 2:1 左右，
  只能当填充，文字压在它们上面时一律用墨色。
- **色块自身不承担边界对比度。** 每个色块都被 2px 墨描边包住，边界由描边给出。
  这是这套风格在无障碍上的一个真实优势，不是借口——但它换来的代价就是上一条。
- **不许挪用。** 「已连接」不能用主色，「收藏」不能用绿色。一支色只出现在它绑定的语义上。

### 1.3 深色

| Token | 值 |
|---|---|
| `--paper` | `#101016` |
| `--paper-deep` | `#0a0a0e` |
| `--surface` | `#1e1e28` |
| `--ink` / `--hair` | `#f4ecdf` / `#efe6d8`（描边换成奶油） |
| `--accent` | `#a6a2ff` |
| 硬投影色 | `#3b3684`（深葡萄紫） |

深色下硬投影**不能用纯黑**：投影落在 `#101016` 的页面底上等于没有。换成深葡萄紫，
仍在糖果家族里，又能把「挤出来的实体」立住。

## 2. 字体排印

字族文件与 v2 完全相同，不新增任何字体资源。

```css
--font-serif: "Hanken Grotesk", "Noto Sans SC", "PingFang SC", ...;  /* ← 指向变了 */
--font-sans:  "Hanken Grotesk", "Noto Sans SC", "PingFang SC", ...;
--font-mono:  "JetBrains Mono", "SF Mono", ui-monospace, ...;
```

- **`--font-serif` 不改名、只改指向。** 全站 97 处 `font-serif` 因此一次翻面，
  不必逐处改写。Hanken Grotesk 是 300–800 的可变字体，800 直接可用。
- **中文标题是粗黑体**，和 v2 的宋体正好相反。这是两张皮差异最大的一处，
  也是「波普」的骨相所在。
- 大标题：`font-weight: 800`，`letter-spacing: -0.02em`。
- 数字仍然一律等宽 + `tabular-nums slashed-zero`（与 v2 相同，不变）。

## 3. 形状与投影

| Token | 值 | 说明 |
|---|---|---|
| `--stroke` | `2px` | 全站唯一描边宽度，映射到 Tailwind `borderWidth.DEFAULT` |
| `--r-sm` / `--r-md` / `--r-lg` | `10 / 12 / 16px` | 映射到 `rounded-sm/md/lg` |
| `--r-pill` | `999px` | 按钮、标签、导航项、滑杆 |
| `--shadow-float` | `4px 4px 0` | 硬投影，**零模糊** |
| `--shadow-press` | `1px 1px 0` | 静置态 / 按压态 |
| `--press` | `2px` | 按下时的位移量 |
| `--ease` | `cubic-bezier(.2,.9,.28,1.12)` | 带一点点回弹 |

**按压手感**：hover 往左上抬 1px、投影变长；按下位移 +2px、投影缩到 1px。
由 `.press-pop` 与 `.act-*` 组件类统一实现，编辑风下这些类不产生任何声明。

**底纹**：22px 圆点网格（`radial-gradient`），替掉 v2 的纸面噪点。

## 4. 组件范式

### 4.1 按钮（三级，全部胶囊）
- **主操作**：葡萄紫实底 + 2px 墨描边 + 硬投影，文字用 `--primary-foreground`。
- **次操作**：卡面底 + 2px 墨描边 + 硬投影，hover 换 `--paper-deep`。
- **图标键**：描边圆钮，同样有按压。已激活态（已收藏、已开启）换成主色实底。
- 全站手写的三级动作沿用 `.act-primary` / `.act-secondary` / `.act-icon`。

### 4.2 播放条与进度
- 外壳：上缘 2px 描边，底色 `--surface`。
- 进度轨：12px 描边胶囊，主色填充，hover 浮现 16px 描边圆钮。
- 缓冲层用 `--ink-faint/30`，**不能用 `--hair`**——那在这张皮里是不透明墨色，
  会把整条轨道涂黑。
- 播放主键：44px 葡萄紫实心圆 + 描边 + 硬投影。

### 4.3 正在播放
- 大封面：2px 描边 + 硬投影，无旋转。
- 当前歌词行：**柠檬黄荧光笔胶囊** + 2px 描边（`width: fit-content`）。
  柠檬黄只做底、不做文字，正好是荧光笔的语义。
- 封面取色晕染：**关闭**（`--cover-bleed-opacity: 0`）。

### 4.4 列表
- 行分隔仍是 `divide-y`，行**不加圆角**——加了圆角分隔线两端会翘起来，
  连续几行看上去像每行被框了一个没人设计过的浅色盒子。
- 正在播放的行：整行铺 `accent / 0.2` 糖底；曲名压回墨色
  （葡萄紫压在自己 20% 的糖底上只有 3.0:1，够不到 AA）。

### 4.5 表单与浮层
- 输入框：描边胶囊 + 卡面底 + 按压投影，focus 时描边变主色。
- 开关：描边胶囊轨 + 实心钮，开启为**薄荷绿**（「已开启」绑定 ok 语义）。
- 分段控件：描边胶囊组，当前项主色实底。
- 对话框 / 下拉 / Toast：卡面底 + 2px 描边 + 硬投影。

### 4.6 贴纸
`.sticker` / `.latin-tag` / `.section-head h2 small` 在这张皮里变成糖果贴纸：
糖底 + 2px 描边 + 1px 硬投影 + `rotate(-1.8deg)`。

> `.latin-tag` 是**双语报头的拉丁半边**，非中文界面下整体隐藏。
> 需要一枚任何语言下都在的贴纸时用 `.sticker`。

## 5. 不要清单（违者返工）

- 不要柔和阴影、毛玻璃、渐变按钮——层次只由「描边 + 硬投影」制造。
- 不要把糖果色当装饰随便撒；每一支只出现在它绑定的语义上。
- 不要用浅糖果色写字（浅绿 / 浅黄 / 浅粉只做底）。
- 不要中文标题用宋体——这张皮的标题是粗黑体，和纸·墨·朱正好相反。
- 不要 emoji 当图标，继续用 Phosphor 线性图标。
- 不要在组件里读 `themeStore.skin` 再拼 className。换皮是纯 CSS 的事：
  用 `pop:` / `editorial:` 变体，或写进 index.css 的皮肤块。
- 不要动信息架构、adapter、audio engine、stores、hooks——只改消费它们的样式层。

## 6. 工程约定

### 6.1 皮肤怎么落地

```
<html data-skin="pop" class="dark">
         ↑ 皮肤                ↑ 明暗（沿用原机制，与皮肤正交）
```

四种组合都成立。index.css 里四个 token 块：

```css
:root                              /* 纸·墨·朱（浅）——也是 data-skin 缺失时的兜底 */
.dark                              /* 纸·墨·朱（深） */
html[data-skin='pop']:not(.dark)   /* 糖果·波普（浅） */
html[data-skin='pop'].dark         /* 糖果·波普（深） */
```

> 皮肤块必须写成两个复合选择器。`:root` 与 `.dark` 都是 (0,1,0)，
> 皮肤块若只写 `[data-skin='pop']` 会和 `.dark` 打平、按源码顺序赢，把深色整个盖掉。

### 6.2 token 分三层

1. **颜色**（RGB 通道，配 `rgb()`；`--hair` 自带 alpha，消费方不能再叠 `/70`）
2. **shadcn 语义**（HSL 通道，供 Tailwind 语义类消费）
3. **形状 / 字体 / 动效**（v3 新增）——描边宽度、圆角、投影、字族、缓动、底纹

第 3 层是「换皮不只换颜色」的关键。`--stroke` 映射到 Tailwind `borderWidth.DEFAULT`、
`--r-*` 映射到 `borderRadius`，全站 150+ 处 `rounded-*` 与 170+ 处 `border`
无需逐个改写，跟着皮肤自动变形。

### 6.3 Tailwind 变体

`tailwind.config.ts` 注册了 `pop:` 与 `editorial:` 两个变体：

```
pop:bg-primary        →  html[data-skin='pop'] .pop\:bg-primary
editorial:border-hair →  html[data-skin='editorial'] .editorial\:border-hair
```

糖果色只在 pop 皮肤下有定义，**必须配 `pop:` 使用**（`pop:bg-candy-ok-soft`）。
裸用会在编辑风下解析成空值，整条声明失效。

### 6.4 防白闪

`public/theme-preflash.js` 在 bundle 之前同步读 `msp-theme-store`，写好
`data-skin` / `dark` / 首屏底色。它与 `themeStore.ts` 的 `SKIN_BACKGROUNDS`
是同一份数据的两处副本（这里不能 import，模块脚本会推迟到 DOM 解析后执行），
**改色要改两处**。

### 6.5 开发与截图

```bash
node scripts/mock-subsonic.mjs          # 本地假曲库，登录后所有界面都能看
node scripts/shoot-screenshots.mjs      # 可复现地重拍 README 截图（零依赖，走 CDP）
```

### 6.6 闸门

每完成一个阶段必须过：`npx tsc --noEmit`、`npm run lint`、`npm test`、`npm run build`。
