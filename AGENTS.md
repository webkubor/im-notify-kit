# AGENTS.md — AI 助手工作守则

## 这是什么

im-notify-kit —— 飞书（Lark）/ 企业微信群机器人通知的**发送层**：
业务响应校验、重试、超时、告警去重、卡片构建器。零依赖，
跨 Node / Cloudflare Workers / Deno。

## 关键文件

- `src/`：源码（发送、重试、去重、卡片构建器）。
- `test/`：测试 —— 各 IM 平台的响应契约用例在这里，改发送逻辑前先读。

## 常用命令

```bash
npm run build        # 构建
npm run typecheck    # 类型检查
npm run test         # 测试
npm run compat       # 跨运行时兼容测试（Node / Workers / Deno）
```

## 约定

- **零依赖**是产品承诺（跨运行时不打包 node_modules 负担），新功能优先用标准 API 实现。
- 跨运行时兼容靠 `compat` 测试守住：改动必须在三个运行时都过。
- IM 平台的 webhook 响应契约（成功 / 限流 / 错误格式）以测试用例为准。
