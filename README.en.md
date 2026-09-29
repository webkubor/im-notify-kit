# im-notify-kit

[![npm version](https://img.shields.io/npm/v/im-notify-kit.svg)](https://www.npmjs.com/package/im-notify-kit)
[![npm downloads](https://img.shields.io/npm/dw/im-notify-kit.svg)](https://www.npmjs.com/package/im-notify-kit)
[![license](https://img.shields.io/npm/l/im-notify-kit.svg)](./LICENSE)
[![TypeScript types](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/im-notify-kit?activeTab=code)

A **send layer** for Feishu (Lark) / WeCom group-bot notifications. Zero dependencies, runs on Node / Cloudflare Workers / Deno.

```bash
npm i im-notify-kit
```

## Why this package exists

The same notification code gets rewritten in every project, and the same trap gets re-stepped on each time:

**HTTP 200 does not mean delivered.** When a bot is removed from a group, disabled, triggers group safety settings, or fails keyword matching — Feishu and WeCom **still return HTTP 200**, with the failure hidden inside `body.code` / `body.errcode`. Code that just checks `res.ok` will treat those as successful sends. If you've also bolted on a "don't re-send within 15 min" dedupe, that one misjudgement will silence the entire window's alerts — **nobody gets them, nobody knows nobody got them.**

This package keeps that judgment in one place and does one thing: send the message, and honestly tell you whether it landed.

## Use

### One message

```ts
import { feishu, wecom } from 'im-notify-kit'

await feishu.text(FEISHU_HOOK, 'build failed')
await wecom.markdown(WECOM_HOOK, '**build failed**')

const r = await feishu.card(FEISHU_HOOK, {
  title: 'API exception',
  template: 'red',
  markdown: '**endpoint**: `POST /api/feedback`\n**status**: HTTP 500',
  buttons: [{ text: 'see logs', url: 'https://example.com/logs', type: 'primary' }],
})

if (!r.ok) console.error(r.error, r.code, r.response)
```

### Same content, multiple platforms

Same content, **rendered as interactive cards on both sides**: Feishu renders it as `interactive`, WeCom as `template_card` (main title + key/value section + jump buttons).

The two card structures are completely different — Feishu is `{msg_type:'interactive', card:{header, elements}}`, WeCom is `{msgtype:'template_card', template_card:{card_type, main_title, ...}}`. POST a Feishu JSON to a WeCom webhook and WeCom returns HTTP 200 + non-zero `errcode`, the message never lands. This package renders per platform, so you write one content object.

Lines in the form `**key**: value` are auto-extracted into WeCom's key/value section (alert messages are naturally shaped this way); lines that don't fit stay in the subtitle, nothing lost.

```ts
import { notify } from 'im-notify-kit'

const results = await notify(
  [
    { platform: 'feishu', url: FEISHU_HOOK, name: 'alerts' },
    { platform: 'wecom',  url: WECOM_HOOK,  name: 'ops' },
  ],
  { title: 'release done', markdown: 'v1.2.0 is live', template: 'green' },
)

results.filter(r => !r.ok).forEach(r => console.error(r.target.name, r.error))
```

Concurrent sends, **never throws** — a single failed target doesn't break the others; you get a complete report.

### DM the owner (feishu-app)

Feishu group-bot webhooks can only push into groups; DMs (or business messages under user identity) go through the open platform's `im/v1/messages`, requiring `tenant_access_token` and a recipient `open_id` / `email` / `union_id` (`chat_id` for groups). Token fetching/caching is the caller's job — this package doesn't touch app credentials, only sends the message.

```ts
import { notify, feishuApp } from 'im-notify-kit'

// Single DM
await feishuApp.card(ACCESS_TOKEN, 'ou_owner', {
  title: 'muse error',
  markdown: '**trace_id**: `muse-abc-123`',
  template: 'red',
}, 'open_id')

// Mixed: group webhook + owner DM
await notify(
  [
    { platform: 'feishu', url: FEISHU_HOOK, name: 'group' },
    {
      platform: 'feishu-app',
      appAccessToken: ACCESS_TOKEN,
      appReceiveId: 'ou_owner',
      appReceiveIdType: 'open_id',
      name: 'owner DM',
    },
  ],
  { title: 'disk alert', markdown: '**usage**: 92%', template: 'red' },
)

// Plain text only (not a card)
await notify(
  [{ platform: 'feishu-app', appAccessToken: ACCESS_TOKEN, appReceiveId: 'ou_owner' }],
  { text: 'disk usage 92%' },
)
```

`markdown` and `text` are mutually exclusive: `markdown` renders as a card, `text` sends as plain text (when a webhook target receives `text`-only, it falls back to the card body, nothing lost). If you pass neither, `notify()` returns a failed result directly.

### API 5xx alerting

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
    system: 'manager backend',
    logUrl: 'https://manager.example.com/api-logs',
  },
)
```

Three hard rules baked in:

- **Only 5xx, never 4xx.** 4xx is caller error (unauthenticated, bad params, unauthorized) — high volume, mostly normal rejections; pushing them drowns real issues.
- **Dedupe by default**, keyed on `route + status`, 15-minute window. A broken endpoint combined with a 1-minute frontend poll can produce dozens of requests; without dedupe the group gets spammed, everyone mutes the bot, and alerting dies — worse than no alerting.
- **Know the dedupe trade-off**: during an ongoing incident, the group will be quiet. Treat each alert as the only one you're getting — don't wait for a second.

## API

| Function | Notes |
|---|---|
| `feishu.text(url, content, opts?)` | Feishu plain text |
| `feishu.card(url, msg, opts?)` | Feishu interactive card |
| `feishu.buildCard(msg)` | Card payload only (use when going through open platform API, not group webhook) |
| `feishuApp.text(token, receiveId, content, receiveIdType?, opts?)` | Feishu app message plain text (DM / group send) |
| `feishuApp.card(token, receiveId, msg, receiveIdType?, opts?)` | Feishu app message interactive card |
| `wecom.text(url, content, opts?)` | WeCom plain text |
| `wecom.markdown(url, content, opts?)` | WeCom markdown |
| `wecom.templateCard(url, msg, opts?)` | WeCom template card (interactive, with key/value + jump) |
| `wecom.card(url, msg, opts?)` | Platform-neutral send to WeCom (defaults to template card) |
| `wecom.buildTemplateCard(msg, fallbackUrl?)` | WeCom card payload only |
| `wecom.renderMarkdown(msg)` | Markdown text only (when you need plain-text render) |
| `notify(targets, msg, opts?)` | One message, multiple targets |
| `apiAlert(targets, info, opts?)` | API 5xx alert |
| `sendPayload(platform, url, payload, opts?)` | Lowest-level exit, for custom payloads (old name `postWebhook`, deprecated) |

### Target

`Target` is a discriminated union, narrowed per platform — wrong types fail at compile time:

- **webhook targets** (`feishu` / `wecom`): `{ platform, url, name? }` — `url` required
- **feishu-app targets**: `{ platform: 'feishu-app', appAccessToken, appReceiveId, appReceiveIdType?, name? }` — credential fields required

### SendOptions

| Field | Default | Notes |
|---|---|---|
| `retries` | `2` | Retry count (not counting the first attempt). Only retries network errors, timeouts, 5xx, 429, Feishu 9499, WeCom 45009 — wrong params or "bot removed from group" never improve with retries, fail fast |
| `timeoutMs` | `10000` | Per-attempt timeout. Without a timeout you hang on OS-level TCP timeouts |
| `retryBaseMs` | `500` | Backoff base; actual wait is `base * 2^(n-1)` |
| `fetchImpl` | global `fetch` | Inject fetch for tests / special runtimes |
| `dedupe` | none | `{ key, windowMs?, store? }`; not passing means no dedupe |

### SendResult

```ts
{
  ok: boolean          // HTTP 2xx AND platform business code 0, only then true
  httpStatus: number   // 0 if the network layer itself failed
  code?: number        // Feishu body.code / WeCom body.errcode
  response: string     // raw response body (truncated to 500 chars)
  attempts: number     // actual attempts made
  error?: string       // human-readable failure reason
  deduped?: boolean    // blocked by dedupe — not a failure, "just sent, intentionally skipping"
}
```

## Stateless runtimes (important)

Dedupe uses **process memory** by default. Cloudflare Workers / Pages Functions / Lambda each request can be a new isolate — module-level `Map` won't survive a single request — **in those environments default dedupe equals no dedupe**. You must inject an external store:

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

Two implementation rules:

- `shouldSend` **should return `true` if the query fails**. Better to over-send than silently drop alerts on storage hiccups.
- Only **successful sends** call `markSent`. If failure also marked, one failure would silence the entire window.

## Cloudflare Pages Functions — a known gotcha

`wrangler pages deploy` bundles the `functions/` directory, and `import ... from 'im-notify-kit'` inside relies on `node_modules` resolution. If your CI splits "build" and "deploy" into two jobs, and the deploy job only inherits `dist/` artifacts without installing dependencies, deploy will fail:

```
✘ [ERROR] Could not resolve "im-notify-kit"
```

Fix: add a dependency install step in the deploy job:

```yaml
deploy:
  needs: [build]
  script:
    - npm ci --ignore-scripts   # ← without this, "Could not resolve"
    - npx wrangler pages deploy dist --project-name=xxx --branch=main
```

Worth flagging is the shape of this failure: typecheck and build are both green, only deploy is red, the live site is still running the old version, behaving normally. Easy to dismiss as flaky deploys; in reality every commit after that hasn't shipped.

Also: running `npx wrangler pages functions build` locally will **pass** — because `node_modules` exists locally. Validation that's stricter in CI than locally is fake validation; don't trust it.

## What this package doesn't do

It only sends. Reading config, writing send logs, storing dedupe state — none of that, since each project's storage is different (Supabase / KV / D1 / in-memory), and bundling any one of them would force callers to live with the package's choice. Where persistence is needed, use dependency injection (`DedupeStore`).

Likewise, Feishu open platform's `tenant_access_token`, `open_id` resolution, image upload, @-mentions don't live here: those need app credentials and tenant context, which are a different thing from "group-bot webhook"; mixing them in would turn this package from a "zero-dep send layer" into a "Feishu SDK".

## License

MIT