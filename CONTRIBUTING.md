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
  不要硬编码色值。注意 `docs/redesign/DESIGN.md` 记录的是上一代的祖母绿体系，
  已经作废——现行是「纸 · 墨 · 朱」。
- **全局唯一强调色**。朱红只用于强调，红色仅限 destructive。不要引入第二个色相。
- **不做卡片堆叠、不做阴影层叠**。结构由排版、发丝线与留白承担。
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
