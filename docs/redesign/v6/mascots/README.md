# 糯米与毛豆（v6 吉祥物）

**角色版权归 N1KO 所有**（出自作者的双语绘本《糯米和毛豆》），随本仓库与安装包分发，**不随 MIT 许可授权**。
糯米是白兔，穿芥末黄背带裤；毛豆是绿青蛙，穿红白条纹 T 恤与米色短裤，戴一副青柠色耳机。

## 来源链

| 环节 | 文件 | 说明 |
| --- | --- | --- |
| 出图 | `*.png`（不入库）、`reference/*.webp` | 用 Codex 从绘本角色生成的毛绒玩具质感渲染图：合影、三视图、表情表与各个单人姿势。提示词见 [`codex-prompts.md`](codex-prompts.md) |
| 抠图与后期 | [`cutout.py`](cutout.py) | 本机抠图（rembg / ISNet，不上传）；被主体包住、颜色又不是底色的半透明洞（白毛、眼白和白底太像被抠虚了）补实；清残底、去底色污染；落地阴影只认比局部底色暗、又挨着脚边的地方（原图的底是渐变，按整张均值比会把整片地面变灰）；裁边、转 WebP。眨眼帧：以变化最大的几块为种子长成整只眼睛，只取眼睛那几块，别处 Codex 重画的细小出入一律不进 |
| 上线 | `frontend/public/mascots/*.webp` | 由 `components/common/Mascot.tsx` 与开屏 `components/common/Splash.tsx` 显示 |

App 里用的就是 Codex 的渲染图本身。v6 一度用 Blender 脚本拿基本体拼过 3D 版本，质感远不到原图的水准，已经弃用；2026-10 又用 AI 底模 + Blender 做过一版可摆姿势的 3D（工程在不入库的 `3d/`），和原图并排比差距仍然不小，同样弃用。

处理一张：

```sh
cd docs/redesign/v6/mascots
python3 -m venv .venv && .venv/bin/pip install "rembg[cpu]" pillow numpy   # scipy 随 rembg 一起装上
.venv/bin/python cutout.py duo-hero.png ../../../../frontend/public/mascots/duo-wave.webp 960 \
  --blink duo-hero-blink.png ../../../../frontend/public/mascots/duo-wave-blink.webp
.venv/bin/python cutout.py maodou-wave.png ../../../../frontend/public/mascots/maodou-wave.webp 640 \
  --blink maodou-wave-blink.png ../../../../frontend/public/mascots/maodou-wave-blink.webp
.venv/bin/python cutout.py nuomi-wink.png ../../../../frontend/public/mascots/nuomi-wink.webp 640   # 其余单人姿势同理，宽 640
```

## 姿势与用处

一种状态一个姿势：

| 文件 | 姿势 | 用在 |
| --- | --- | --- |
| `duo-wave` | 两只一起挥手 | 开屏、登录欢迎 |
| `nuomi-wink` | 糯米眨眼挥手 | 空收藏（`EmptyState` 默认） |
| `nuomi-sleep` | 糯米坐着睡着 | 安静、没东西（队列空、榜单空、唱片说明空） |
| `maodou-listen` | 毛豆戴着耳机闭眼听 | 「听了才会有」（最近播放、统计、口味、推荐） |
| `maodou-surprised` | 毛豆吃惊 | 出错、没找到 |
| `maodou-wave` | 毛豆招手 | 「去搜一搜」（搜索页、不能浏览的音源） |

规矩：吉祥物只出现在「没有内容可看」的时刻，从不压在内容或操作上；它是装饰，对读屏隐藏，话都在旁边的文字里；减弱动态效果时停在静帧。
