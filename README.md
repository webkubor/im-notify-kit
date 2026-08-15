# im-notify-kit

飞书（Lark）/ 企业微信群机器人通知的**发送层**。零依赖，跨 Node / Cloudflare Workers / Deno。

```bash
npm i im-notify-kit
```

## 为什么有这个包

因为同一段推送代码在每个项目里都被重写了一遍，而且每次都漏掉同样的坑：

**HTTP 200 不代表消息送达。** 机器人被移出群、被停用、触发群安全设置、关键词不匹配——飞书和企微在这些情况下**照样返回 HTTP 200**，失败信息藏在 `body.code` / `body.errcode` 里。只判断 `res.ok` 的代码会把这些当成推送成功。如果你还顺手做了「推过就 15 分钟内不再推」的去重，那么这一次误判会把整个窗口期的告警全堵死——**没人收到，也没人知道没收到**。

这个包把这类判断收在一个地方，只做一件事：把消息发出去，并诚实告诉你发没发到。

## 用

### 发一条

```ts
import { feishu, wecom } from 'im-notify-kit'

await feishu.text(FEISHU_HOOK, '构建失败')
await wecom.markdown(WECOM_HOOK, '**构建失败**')

const r = await feishu.card(FEISHU_HOOK, {
  title: '接口异常',
  template: 'red',
  markdown: '**接口**：`POST /api/feedback`\n**状态**：HTTP 500',
  buttons: [{ text: '看日志', url: 'https://example.com/logs', type: 'primary' }],
})

if (!r.ok) console.error(r.error, r.code, r.response)
```

### 一条消息发多个平台

同一份内容，**两边都是可交互卡片**：飞书渲染成 `interactive` 卡片，企微渲染成 `template_card`（主标题 + 键值区 + 跳转按钮）。

两家的卡片结构完全不同——飞书是 `{msg_type:'interactive', card:{header, elements}}`，企微是 `{msgtype:'template_card', template_card:{card_type, main_title, ...}}`。把飞书那份 JSON POST 给企微 webhook，企微会回 HTTP 200 + `errcode` 非 0，消息进不去群。这个包按 platform 分别渲染，所以你写一份内容就行。

正文里 `**键**：值` 形式的行会自动抽成企微卡片的键值区（告警消息本来就是这个形状），抽不出来的行留在副标题，不丢内容。

```ts
import { notify } from 'im-notify-kit'

const results = await notify(
  [
    { platform: 'feishu', url: FEISHU_HOOK, name: '告警群' },
    { platform: 'wecom', url: WECOM_HOOK, name: '运维群' },
  ],
  { title: '发版完成', markdown: 'v1.2.0 已上线', template: 'green' },
)

results.filter(r => !r.ok).forEach(r => console.error(r.target.name, r.error))
```

并发发送，**永不抛异常**——单个目标失败不影响其它目标，你拿到的是一份完整战报。

### 接口 5xx 告警

```ts
import { apiAlert } from 'im-notify-kit'

await apiAlert(
  [{ platform: 'feishu', url: FEISHU_HOOK }],
  {
    route: '/api/feedback',
    method: 'POST',
    status: 500,
    detail: err.message,
    who: user.email,
    system: '好易美后台',
    logUrl: 'https://manager.example.com/api-logs',
  },
)
```

自带三条硬规矩：

- **只推 5xx，不推 4xx**。4xx 是调用方的问题（没登录、参数不对、越权），量大且多数是正常拒绝，推了只会淹没真问题。
- **默认去重**，按 `route + status` 为键、15 分钟窗口。一个坏接口配合前端轮询一分钟能发几十次请求，不去重群会被刷爆，然后所有人把机器人静音——那时告警就彻底失效，比没有告警更糟。
- **去重的代价你要知道**：故障持续期间群里是安静的。收到一条就得当回事，别等第二条。

## API

| 函数 | 说明 |
|---|---|
| `feishu.text(url, content, opts?)` | 飞书纯文本 |
| `feishu.card(url, msg, opts?)` | 飞书交互卡片 |
| `feishu.buildCard(msg)` | 只拿卡片 payload（要走开放平台 API 而非群机器人时用） |
| `wecom.text(url, content, opts?)` | 企微纯文本 |
| `wecom.markdown(url, content, opts?)` | 企微 markdown |
| `wecom.templateCard(url, msg, opts?)` | 企微模板卡片（可交互，带键值区和跳转） |
| `wecom.card(url, msg, opts?)` | 用平台中立消息发企微，默认走模板卡片 |
| `wecom.buildTemplateCard(msg, fallbackUrl?)` | 只拿企微卡片 payload |
| `wecom.renderMarkdown(msg)` | 只拿 markdown 文本（需要纯文本渲染时用） |
| `notify(targets, msg, opts?)` | 一条消息发多个目标 |
| `apiAlert(targets, info, opts?)` | 接口 5xx 告警 |
| `postWebhook(platform, url, payload, opts?)` | 底层出口，自定义 payload 时用 |

### SendOptions

| 字段 | 默认 | 说明 |
|---|---|---|
| `retries` | `2` | 重试次数（不含第一次）。只重试网络异常、超时、5xx、429、飞书 9499、企微 45009——参数错、机器人被踢出群这类重试一万次也一样，直接放弃 |
| `timeoutMs` | `10000` | 单次尝试超时。不设超时就是挂在 OS 层 TCP 超时上，不可接受 |
| `retryBaseMs` | `500` | 退避基数，实际等待 `base * 2^(n-1)` |
| `fetchImpl` | 全局 `fetch` | 注入 fetch，测试和特殊运行时用 |
| `dedupe` | 无 | `{ key, windowMs?, store? }`，不传则不去重 |

### SendResult

```ts
{
  ok: boolean          // HTTP 2xx 且平台业务码为 0，才是 true
  httpStatus: number   // 网络层就失败时为 0
  code?: number        // 飞书 body.code / 企微 body.errcode
  response: string     // 原始响应体（截断 500 字）
  attempts: number     // 实际尝试次数
  error?: string       // 人话失败原因
  deduped?: boolean    // 被去重拦下——这不是失败，是「刚推过，故意不推」
}
```

## 无状态运行时（重要）

去重默认用**进程内存**。Cloudflare Workers / Pages Functions / Lambda 每次请求都可能是新 isolate，模块级 Map 撑不过一次请求——**在那些环境里默认去重等于没开**。必须注入外部存储：

```ts
import type { DedupeStore } from 'im-notify-kit'

const kvStore: DedupeStore = {
  async shouldSend(key, windowMs) {
    const hit = await env.KV.get(key)
    return !hit
  },
  async markSent(key, windowMs) {
    await env.KV.put(key, '1', { expirationTtl: Math.ceil(windowMs / 1000) })
  },
}

await apiAlert(targets, info, { dedupe: { key: `alert:${route}:${status}`, store: kvStore } })
```

两条实现约定：

- `shouldSend` **查询失败时应返回 `true`**。宁可多推一条，也不要因为存储抖动就静默丢掉告警。
- 只有**发送成功**才会调 `markSent`。失败也打标记的话，一次失败就把整个窗口期堵死了。

## 在 Cloudflare Pages Functions 里用（有个坑）

`wrangler pages deploy` 会 bundle `functions/` 目录，里面的 `import ... from 'im-notify-kit'`
要靠 `node_modules` 解析。如果你的 CI 把「构建」和「部署」拆成两个 job，而部署 job 只继承了
`dist/` 产物、没装依赖，部署会失败：

```
✘ [ERROR] Could not resolve "im-notify-kit"
```

修法是在部署 job 里补一步装依赖：

```yaml
deploy:
  needs: [build]
  script:
    - npm ci --ignore-scripts   # ← 少了这行就 Could not resolve
    - npx wrangler pages deploy dist --project-name=xxx --branch=main
```

值得警惕的是这个失败的形态：typecheck、build 全绿，只有 deploy 红，线上还跑着旧版本、
表现完全正常。很容易被当成偶发的部署抖动，实际是那之后的提交全都没上线。

另外，本地跑 `npx wrangler pages functions build` 验证会**通过**——因为本地有
`node_modules`。本地环境比 CI 多点东西的验证是假验证，别拿它当数。

## 这个包不做什么

只做发送。读配置、写推送日志、存去重状态一律不碰——那些每个项目的存储都不一样（Supabase / KV / D1 / 内存），塞进来只会逼调用方迁就包的口味。需要持久化的地方走依赖注入（`DedupeStore`）。

同理，飞书开放平台的 `tenant_access_token`、`open_id` 解析、图片上传、@提及也不在这里：那些需要应用凭据和租户上下文，跟「群机器人 webhook」是两套东西，混进来会让这个包从「零依赖发送层」变成「飞书 SDK」。

## License

MIT
