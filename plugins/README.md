# N1KO 插件

流媒体音源插件。协议合同见 [`docs/sources/PROTOCOL.md`](../docs/sources/PROTOCOL.md)（v1）；
宿主实现见 `frontend/src/plugins/`（沙箱运行时、PluginHost、安装与目录）。

## 目录结构

```
plugins/
  catalog.json          本地插件目录（开发态由 Vite 中间件供给 App）
  mock/                 Mock 音源：离线假数据 + 模拟扫码 + 短时效流（测过期重取）
    manifest.json
    index.js
  netease/              网易云（阶段 3）
  qqmusic/              QQ 音乐（阶段 4）
  test/
    harness.mjs         Node 里加载插件的测试骨架（工厂签名与沙箱一致）
    *.test.mjs          node --test
```

## 本地调试

1. `npm run dev`（frontend）——开发态默认插件目录 `/__n1ko_plugins/catalog.json`
   由 Vite 中间件直接读本目录，改完插件代码刷新 App 即生效（目录地址设置里可换）。
2. 测试：仓库根 `npm run test:plugins`（等价 `node --test plugins/test/`）。
   骨架用 `new Function` 以与沙箱相同的工厂签名执行插件（仅测试；线上走 blob 脚本），
   `require('axios')` 由 undici/fetch 的同形实现顶替，`crypto-js` 等实包从
   `frontend/node_modules` 解析——插件源码与依赖都不进 App 的构建产物。

## 写插件的要点

- 单文件 CommonJS：`module.exports = { platform, version, ...方法, n1ko: { auth, user } }`。
  沙箱里没有相对路径 require，代码全在一个文件里。
- 不出网直连：所有请求经 `require('axios')`（宿主按 manifest `hosts` 白名单放行并记日志）；
  `cheerio` 不可用，解析 HTML 用沙箱里的 `DOMParser`。
- 凭据只经 `env.setCredentials()` 回写宿主（加密落盘）；非敏感缓存用 `env.storage`。
- 错误一律 `throw new PluginError(code, message)`，code 取 PROTOCOL §7 的七种。
- manifest 的 `disclaimer` 会在添加音源时展示并要求确认；`hosts` 有新增的更新要重新确认。

## 发布前拆仓库

本目录随主仓库开发迭代（阶段 0-5）；正式发布时拆成独立仓库（或静态站点），
`catalog.json` 变成线上目录，App 的「插件目录地址」默认值届时再定——
发布流程归 N1KO，执行方不碰版本与默认目录地址。
