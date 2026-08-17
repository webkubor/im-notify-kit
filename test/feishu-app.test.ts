import { describe, it, expect, vi } from 'vitest'
import * as feishuApp from '../src/feishu-app.js'

describe('feishu-app（飞书开放平台 im/v1/messages 应用消息）', () => {
  it('appAccessToken 缺失 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.text('', 'open_123', 'hi', 'open_id')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appAccessToken/)
  })

  it('appReceiveId 缺失 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.card('t-xxx', '', { markdown: 'hi' }, 'open_id')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appReceiveId/)
  })

  it('appReceiveIdType 非法 → 失败结果 + 友好错误', async () => {
    const r = await feishuApp.text('t-xxx', 'open_123', 'hi', 'invalid' as any)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/appReceiveIdType/)
  })

  it('text 正常调用 → POST im/v1/messages 带 Authorization 头 + 正确 body', async () => {
    let called = 0
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      called++
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const r = await feishuApp.text('t-xxx', 'ou_abc', 'hello world', 'open_id', { fetchImpl, retries: 0 })
    expect(called).toBe(1)
    expect(r.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('card 正常调用 → msg_type=interactive + content 是飞书卡片 JSON', async () => {
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body)
      expect(body.msg_type).toBe('interactive')
      const card = JSON.parse(body.content)
      expect(card.header).toBeDefined()
      expect(card.elements).toBeDefined()
      return new Response(JSON.stringify({ code: 0, msg: 'success' }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await feishuApp.card('t-xxx', 'oc_chat', { title: '测试', markdown: '**粗体**', template: 'red' }, 'chat_id', { fetchImpl, retries: 0 })
    expect(r.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('业务码非 0 → ok=false 且不被重试', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 230002, msg: 'token 无效' }), { status: 200 })) as unknown as typeof fetch
    const r = await feishuApp.text('t-bad', 'ou_abc', 'hi', 'open_id', { fetchImpl, retries: 2 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(230002)
    expect(fetchImpl).toHaveBeenCalledOnce() // 业务码失败不该重试
  })

  it('HTTP 500 → 重试到耗尽', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }))
    const r = await feishuApp.text('t-xxx', 'ou_abc', 'hi', 'open_id', { fetchImpl, retries: 1 })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(2) // 第一次 + 1 次重试
  })
})