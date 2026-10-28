# 参与贡献 / Contributing

> [English](CONTRIBUTING_EN.md)

## 开发环境

```bash
git clone https://github.com/baogutang/N1KO-MUSIC.git
cd N1KO-MUSIC
cd frontend && npm ci && npm run dev
```

前端跑在 `http://localhost:5173`。没有自己的音乐服务器时，
可以直接连 Navidrome 官方演示服务器：

- 地址 `https://demo.navidrome.org`
- 用户名 / 密码 `demo` / `demo`

可选的同步后端（收藏、歌单、统计跨设备同步）：

```bash
cd backend && npm ci && npm run dev
```

## 提交之前

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm test
```

改到 `backend/` 时另外跑 `cd backend && npm test`。

CI 会跑同样的检查，`--max-warnings 0` 意味着任何 ESLint 警告都会让流水线失败。

## 设计契约

这个项目在视觉上有明确取向，改 UI 前请先读一遍：

- **颜色一律走 token**。真源是 `frontend/src/index.css` 顶部的 CSS 变量，
  不要硬编码色值；用法见根目录的 [`DESIGN.md`](DESIGN.md)（v6「舞台光」）。
  `docs/redesign/` 下的旧文档（祖母绿、纸 · 墨 · 朱、暖纸）都已作废，只作历史保留。
- **一种强调色，两层用法**。青柠只做填色（这一屏唯一的主操作、播放键、进度、当前项），
  叶绿是文字强调；收藏的心是墨色；红色仅限 destructive。不要引入第二个色相——
  房间里的颜色来自正在播放的封面，不来自界面本身。
- **不做卡片堆叠**。结构由排版、留白与一个设备像素的线承担；只有浮在内容上面的东西
  （标签栏、迷你播放条、菜单）才是玻璃胶囊。
- **动效只动 transform / opacity**，不写 `transition-all`；弹簧参数用 `frontend/src/lib/motion.ts`，
  每个动画都要有「减弱动态效果」的退路。
- **图标只用 `@phosphor-icons/react`**，激活态用 `weight="fill"`。不要引入 lucide-react。
- **数字用 `.num` / `font-num`**（等宽 + tabular）。
- **长 CJK 标题**记得 `truncate` + `min-w-0`；中西文混排的细空格由
  `spaceCJK()` 在渲染层处理。

## 服务器能力

适配器要同时覆盖 Subsonic、Jellyfin、Emby。只有部分服务器支持的能力
一律声明为 `MusicServerAdapter` 上的**可选方法**，并在 UI 侧做能力探测——
不支持的服务器上整个入口不出现，而不是让用户点了没反应。

## 提交信息

使用 [Conventional Commits](https://www.conventionalcommits.org/)：
`feat:` `fix:` `perf:` `docs:` `refactor:` `test:` `chore:`。

正文请说明**为什么**这样改，尤其是播放、随机、推荐这些有历史包袱的区域。

## 报告问题

用 issue 模板，把服务器类型与版本填全。这个项目对接四种服务器协议，
缺少这项信息基本无法定位。
