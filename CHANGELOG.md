# CHANGELOG

## v0.1.0

首个版本。从好易美后台（hym-admin）和牧之猫砂后台（mzmeso-manager）里重复了两遍的
推送代码抽出来，起因是 2026-08-15 的一次静默失效：接口 500 了，告警"推成功"了，
但没人收到——因为只判断了 `res.ok`，没看飞书的 `body.code`。

- 飞书群机器人：纯文本 / 交互卡片
- 企业微信群机器人：纯文本 / markdown
- `notify()` 一条消息发多个平台，飞书卡片 ↔ 企微 markdown 自动降级渲染
- `apiAlert()` 接口 5xx 告警（只推 5xx、默认去重、红色卡片）
- 业务码校验：HTTP 200 + `code`/`errcode` ≠ 0 判定为未送达
- 重试：只对网络异常 / 超时 / 5xx / 429 / 飞书 9499 / 企微 45009 重试，指数退避
- 超时：默认 10s，不挂在 OS 层 TCP 超时上
- 去重：可注入 `DedupeStore`，默认内存实现（无状态运行时必须自己注入）
- 零运行时依赖，ESM，Node ≥ 20.19 / Cloudflare Workers / Deno
