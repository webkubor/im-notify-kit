import { describe, it, expect, vi } from 'vitest'
import * as feishuApp from '../src/feishu-app.js'
import { notify } from '../src/index.js'

/** 抓取请求的 url / headers / body，方便逐项断言 */
function captureFetch() {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200 })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const TOKEN = 't-xxx'

describe('feishu-app（飞书开放平台 im/v1/messages 应用消息）', () => {
  it('appAccessToken 缺失 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.text('', 'open_123', 'hi', 'open_id')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appAccessToken/)
  })

  it('appReceiveId 缺失 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.card(TOKEN, '', { markdown: 'hi' }, 'open_id')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appReceiveId/)
  })

  it('appReceiveIdType 非法 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.text(TOKEN, 'open_123', 'hi', 'invalid' as never)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appReceiveIdType/)
  })

  it('text 正常调用 → 带 Authorization 头 + 正确 body + 正确 URL', async () => {
    const { fn, calls } = captureFetch()
    const r = await feishuApp.text(TOKEN, 'ou_abc', 'hello world', 'open_id', { fetchImpl: fn, retries: 0 })

    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]!.url).toContain('/open-apis/im/v1/messages?receive_id_type=open_id')
    expect(calls[0]!.body).toEqual({ receive_id: 'ou_abc', msg_type: 'text', content: JSON.stringify({ text: 'hello world' }) })
  })

  it('card 正常调用 → msg_type=interactive + content 是飞书卡片 JSON', async () => {
    const { fn, calls } = captureFetch()
    const r = await feishuApp.card(TOKEN, 'oc_chat', { title: '测试', markdown: '**粗体**', template: 'red' }, 'chat_id', { fetchImpl: fn, retries: 0 })

    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]!.url).toContain('receive_id_type=chat_id')
    const body = calls[0]!.body as { msg_type: string; content: string }
    expect(body.msg_type).toBe('interactive')
    const card = JSON.parse(body.content) as { header?: unknown; elements?: unknown }
    expect(card.header).toBeDefined()
    expect(card.elements).toBeDefined()
  })

  it('P1 回归：注入 fetchImpl 也必须带上 Authorization —— 鉴权不能被跳过', async () => {
    const { fn, calls } = captureFetch()
    const r = await feishuApp.text(TOKEN, 'ou_abc', 'hi', 'open_id', { fetchImpl: fn, retries: 0 })

    expect(r.ok).toBe(true)
    expect(calls[0]!.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`)
  })

  it('业务码非 0 → ok=false 且不被重试', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ code: 230002, msg: 'token 无效' }), { status: 200 })) as unknown as typeof fetch
    const r = await feishuApp.text('t-bad', 'ou_abc', 'hi', 'open_id', { fetchImpl: fn, retries: 2 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(230002)
    expect(fn).toHaveBeenCalledOnce() // 业务码失败不该重试
  })

  it('HTTP 500 → 重试到耗尽', async () => {
    const fn = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    const r = await feishuApp.text(TOKEN, 'ou_abc', 'hi', 'open_id', { fetchImpl: fn, retries: 1 })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(2) // 第一次 + 1 次重试
  })

  it('notify() text-only 消息 → feishu-app 发纯文本（不用传空 markdown）', async () => {
    const { fn, calls } = captureFetch()
    const results = await notify(
      [{ platform: 'feishu-app', appAccessToken: TOKEN, appReceiveId: 'ou_owner', name: 'owner' }],
      { text: '磁盘占用 92%' },
      { fetchImpl: fn, retries: 0 },
    )

    expect(results[0]!.ok).toBe(true)
    const body = calls[0]!.body as { msg_type: string; content: string }
    expect(body.msg_type).toBe('text')
    expect(JSON.parse(body.content)).toEqual({ text: '磁盘占用 92%' })
  })

  it('notify() 空消息（无 markdown 无 text）→ 直接失败，不发请求', async () => {
    const { fn, calls } = captureFetch()
    const results = await notify(
      [{ platform: 'feishu-app', appAccessToken: TOKEN, appReceiveId: 'ou_owner' }],
      {} as never,
      { fetchImpl: fn, retries: 0 },
    )

    expect(results[0]!.ok).toBe(false)
    expect(results[0]!.error).toMatch(/markdown 或 text/)
    expect(calls).toHaveLength(0)
  })
})
