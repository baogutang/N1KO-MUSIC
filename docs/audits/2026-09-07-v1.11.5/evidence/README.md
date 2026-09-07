# 隔离复现材料

这些断言刻意检查 **缺陷存在时的行为**。全部通过意味着复现成功，不意味着产品通过验收。修复后应将对应断言改成报告给出的正确行为，再纳入正式回归集。

审阅基线：`b9ed5181b721563ec0d9145b7ada3338326adf92`。需要已有的 frontend/backend 依赖与项目支持的 Node 环境；运行器不会自动安装依赖。

在仓库根目录运行：

```sh
node docs/audits/2026-09-07-v1.11.5/evidence/run-probes.mjs
```

运行器会把 Vitest 探针复制到临时目录，使用真实业务函数/Hook 配合模拟适配器和媒体对象；QQ 插件探针使用合成响应；后端探针构建当前后端，在本机临时端口启动服务，并使用全新的临时数据库。结束后清理临时目录。它不读取已安装播放器的账号、音乐库或本地存储，也不向 NAS/网易云/QQ 发请求。后端构建会更新被忽略的 `backend/dist/`。

| 文件/检查 | 数量 | 对应报告 |
|---|---:|---|
| behavior.test.ts：整秒歌词、JSON 歌词、Live 去重、无来源种子、断源收藏、榜单分页、屏蔽缓存、VIP 候选、切歌失败竞态 | 9 | F01、F02、F05–F06、F08–F09、F11 |
| plugin-lifecycle.test.ts：同凭据更新继续复用旧宿主 | 1 | F04 |
| plugin-data-probes.mjs：歌手数组误识别、无损失败不尝试较低音质 | 2 | F03、F14 |
| backend-registration-probe.mjs：first-user 并发两次成功 | 1 | F16 |

原始执行结果存于 `original-results/`。其中路径及账号均为隔离测试夹具；没有打包临时数据库、JWT 密钥或播放器账号数据。重新打包的运行器也已在审阅基线上运行验证。本机界面观察及证据边界见 [observations.md](observations.md)。
