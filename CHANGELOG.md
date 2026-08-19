# CHANGELOG

## v0.3.0

新增 **feishu-app** 通道：飞书开放平台 `im/v1/messages` 应用消息，适用场景是
给 owner 私聊告警 / 按用户身份发业务通知（私聊、群发都支持）。

- `feishuApp.text()` / `feishuApp.card()`：按 `receive_id`（open_id / user_id /
  union_id / chat_id）发应用消息，卡片复用 `feishu.buildCard` 渲染
- `notify()` 混通道分发：`feishu`（群 webhook）与 `feishu-app`（应用消息）可同一条消息并发
- 业务码校验 / 重试策略与飞书群机器人同体系：共用 `code` 字段判定，9499 限流码同样触发重试
- `Platform` 加 `'feishu-app'`；`Target` 加 `appAccessToken` / `appReceiveId` / `appReceiveIdType`
- 向后兼容 100%：feishu / wecom 现有 API 不变（[PR #1](https://github.com/webkubor/im-notify-kit/pull/1)，26 个测试全过）

| 通道 | 适用 | 是否需 token |
|---|---|---|
| `feishu` | 群机器人单向推送 | ❌ |
| `feishu-app` | 私聊 owner / 按身份发业务消息 | ✅ tenant_access_token |

## v0.2.1

文档补丁：README 新增「在 Cloudflare Pages Functions 里用（有个坑）」。

- CI 把构建/部署拆成两个 job 时，部署 job 少了 `npm ci --ignore-scripts` 会报
  `Could not resolve "im-notify-kit"`；补一步装依赖即可
- 附带记录了 Pages Functions 构建被跳过时静默不更新的排查提示，以及
  「本地有 node_modules 的验证是假验证」的教训

## v0.2.0

企微不再降级成纯 markdown —— 和飞书一样发**可交互卡片**。

- 新增 `wecom.templateCard()` / `wecom.buildTemplateCard()`：企微 `template_card`（text_notice），
  主标题 + 键值区 + 跳转按钮
- `wecom.card()` 与 `notify()` 对企微目标默认改走模板卡片（v0.1.0 是 markdown 降级）
- 正文里 `**键**：值` 的行自动抽成企微键值区，反引号等 markdown 标记清掉（企微键值区不渲染
  markdown，留着会原样显示）；抽不出的行进副标题，不丢内容
- `card_action` 始终有值 —— 企微必填，缺了整条消息被拒收

`wecom.renderMarkdown()` 保留，需要纯文本渲染时显式调用。

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
