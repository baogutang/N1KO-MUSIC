# 安全策略 / Security Policy

## 支持的版本

只维护最新的发布版本。请先升级到最新版再报告问题。

## 报告漏洞

**请不要通过公开 issue 报告安全问题。**

请通过 GitHub 的 [Private vulnerability reporting](https://github.com/baogutang/N1KO-MUSIC/security/advisories/new)
提交，或发邮件至仓库主页公开的联系方式。

请尽量包含：

- 受影响的组件（前端 / 同步后端 / 桌面壳 / 移动端）
- 复现步骤
- 影响范围评估

我会在 72 小时内确认收到，并在修复发布后于 release notes 中致谢（如你愿意具名）。

## 威胁模型说明

N1KO MUSIC 是自托管场景下的客户端，设计上假定：

- 用户信任自己连接的音乐服务器。客户端不对服务器返回的内容做沙箱化处理。
- 同步后端默认只服务单个家庭/个人。注册默认为 `first-user` 模式：
  库内还没有用户时允许注册一次，之后自动关闭。
- 服务器凭据存储在浏览器 localStorage 中。这意味着任意 XSS 都等同于凭据泄露，
  因此我们对任何引入 `dangerouslySetInnerHTML` 或动态求值的改动都会严格审查。

如果你的部署把同步后端暴露在公网上，请务必设置强 `JWT_SECRET`
（或让它自动生成）并保持 `ALLOW_REGISTRATION` 为默认值。
