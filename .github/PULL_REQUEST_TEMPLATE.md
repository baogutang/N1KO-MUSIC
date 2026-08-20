## 这个 PR 做了什么

<!-- 一两句话说明改动的意图，而不是罗列改了哪些文件 -->

## 为什么这样改

<!-- 尤其是涉及播放、随机、推荐这些有历史包袱的地方，请说明推理过程 -->

## 自查

- [ ] `npm run lint` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm test` 通过（涉及 backend 时也跑 `cd backend && npm test`）
- [ ] 涉及行为变更时补了测试
- [ ] 新增 UI 遵循 `frontend/src/index.css` 的 token（不硬编码色值），且没有引入 lucide-react
- [ ] 涉及可选服务器能力时做了能力探测，不支持的服务器上入口不出现
