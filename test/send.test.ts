import { describe, it, expect, vi } from 'vitest'
import { feishu, wecom, notify, apiAlert, memoryStore, renderMarkdown } from '../src/index.js'
import type { DedupeStore } from '../src/types.js'

/** 造一个按序返回预设响应的 fetch */
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; payload: unknown }> = []
  let i = 0
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), payload: JSON.parse(String(init?.body ?? '{}')) })
    const r = responses[Math.min(i, responses.length - 1)]!
    i++
    return new Response(JSON.stringify(r.body), { status: r.status })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const HOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test'
const WECOM_HOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'

describe('业务码校验 —— HTTP 200 不等于送达', () => {
  it('飞书 code:0 才算成功', async () => {
    const { fn } = mockFetch([{ status: 200, body: { code: 0, msg: 'success' } }])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn })
    expect(r.ok).toBe(true)
    expect(r.code).toBe(0)
    expect(r.attempts).toBe(1)
  })

  it('飞书 HTTP 200 但 code≠0（机器人被移出群）必须判为失败', async () => {
    const { fn } = mockFetch([{ status: 200, body: { code: 19021, msg: 'bot not in chat' } }])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retries: 0 })
    expect(r.ok).toBe(false)
    expect(r.httpStatus).toBe(200)
    expect(r.code).toBe(19021)
    expect(r.error).toContain('19021')
  })

  it('企微 HTTP 200 但 errcode≠0 必须判为失败', async () => {
    const { fn } = mockFetch([{ status: 200, body: { errcode: 93000, errmsg: 'invalid webhook' } }])
    const r = await wecom.markdown(WECOM_HOOK, '**hi**', { fetchImpl: fn, retries: 0 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(93000)
  })

  it('响应不是 JSON 时按 HTTP 状态判定，不因解析失败误判', async () => {
    const fn = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn })
    expect(r.ok).toBe(true)
    expect(r.code).toBeUndefined()
  })
})

describe('重试', () => {
  it('5xx 会重试，成功后返回累计次数', async () => {
    const { fn } = mockFetch([
      { status: 502, body: {} },
      { status: 200, body: { code: 0 } },
    ])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retryBaseMs: 1 })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
  })

  it('重试到上限仍失败则放弃', async () => {
    const { fn } = mockFetch([{ status: 500, body: {} }])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retries: 2, retryBaseMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(3)
  })

  it('配置错误这类不可重试的失败只发一次', async () => {
    const { fn } = mockFetch([{ status: 200, body: { code: 19021 } }])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retries: 3, retryBaseMs: 1 })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(1)
  })

  it('飞书频控 9499 属于可重试', async () => {
    const { fn } = mockFetch([
      { status: 200, body: { code: 9499 } },
      { status: 200, body: { code: 0 } },
    ])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retryBaseMs: 1 })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
  })

  it('网络异常也会重试', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      if (n++ === 0) throw new Error('network down')
      return new Response(JSON.stringify({ code: 0 }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, retryBaseMs: 1 })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
  })
})

describe('去重', () => {
  it('窗口期内第二次被拦下，且不发网络请求', async () => {
    const store = memoryStore()
    const { fn, calls } = mockFetch([{ status: 200, body: { code: 0 } }])
    const opts = { fetchImpl: fn, dedupe: { key: 'k1', store, windowMs: 60_000 } }

    const first = await feishu.text(HOOK, 'hi', opts)
    const second = await feishu.text(HOOK, 'hi', opts)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(second.deduped).toBe(true)
    expect(calls.length).toBe(1)
  })

  it('发送失败不打标记 —— 一次失败不能堵死整个窗口期', async () => {
    const store = memoryStore()
    const { fn, calls } = mockFetch([
      { status: 200, body: { code: 19021 } },
      { status: 200, body: { code: 0 } },
    ])
    const opts = { fetchImpl: fn, retries: 0, dedupe: { key: 'k2', store, windowMs: 60_000 } }

    const first = await feishu.text(HOOK, 'hi', opts)
    const second = await feishu.text(HOOK, 'hi', opts)

    expect(first.ok).toBe(false)
    expect(second.deduped).toBeUndefined()
    expect(second.ok).toBe(true)
    expect(calls.length).toBe(2)
  })

  it('去重存储查询抛错时放行 —— 宁可多推一条也不静默丢告警', async () => {
    const broken: DedupeStore = {
      shouldSend() { throw new Error('kv down') },
      markSent() { throw new Error('kv down') },
    }
    const { fn } = mockFetch([{ status: 200, body: { code: 0 } }])
    const r = await feishu.text(HOOK, 'hi', { fetchImpl: fn, dedupe: { key: 'k3', store: broken } })
    expect(r.ok).toBe(true)
  })
})

describe('多目标 fan-out', () => {
  it('一个目标失败不影响另一个，返回完整战报', async () => {
    const fn = vi.fn(async (url: string | URL | Request) => {
      const isFeishu = String(url).includes('feishu')
      return new Response(JSON.stringify(isFeishu ? { code: 0 } : { errcode: 93000 }), { status: 200 })
    }) as unknown as typeof fetch

    const results = await notify(
      [
        { platform: 'feishu', url: HOOK, name: '告警群' },
        { platform: 'wecom', url: WECOM_HOOK, name: '运维群' },
      ],
      { title: 'T', markdown: 'body' },
      { fetchImpl: fn, retries: 0 },
    )

    expect(results).toHaveLength(2)
    expect(results[0]!.ok).toBe(true)
    expect(results[0]!.target.name).toBe('告警群')
    expect(results[1]!.ok).toBe(false)
    expect(results[1]!.code).toBe(93000)
  })
})

describe('apiAlert', () => {
  it('4xx 不推送', async () => {
    const { fn, calls } = mockFetch([{ status: 200, body: { code: 0 } }])
    const r = await apiAlert([{ platform: 'feishu', url: HOOK }], {
      route: '/api/x', method: 'GET', status: 404,
    }, { fetchImpl: fn })
    expect(r).toEqual([])
    expect(calls.length).toBe(0)
  })

  it('5xx 推红色卡片，默认按 route+status 去重', async () => {
    const store = memoryStore()
    const { fn, calls } = mockFetch([{ status: 200, body: { code: 0 } }])
    const info = { route: '/api/feedback', method: 'POST', status: 500, system: '好易美后台' }
    const opts = { fetchImpl: fn, dedupe: { key: 'api-alert:/api/feedback:500', store } }

    const first = await apiAlert([{ platform: 'feishu', url: HOOK }], info, opts)
    const second = await apiAlert([{ platform: 'feishu', url: HOOK }], info, opts)

    expect(first[0]!.ok).toBe(true)
    expect(second[0]!.deduped).toBe(true)
    expect(calls.length).toBe(1)

    const card = calls[0]!.payload as { card: { header: { template: string; title: { content: string } } } }
    expect(card.card.header.template).toBe('red')
    expect(card.card.header.title.content).toContain('好易美后台')
  })
})

describe('企微卡片', () => {
  it('默认发 template_card 而不是纯 markdown —— 企微也要可交互卡片', async () => {
    const { fn, calls } = mockFetch([{ status: 200, body: { errcode: 0 } }])
    await wecom.card(WECOM_HOOK, {
      title: '接口异常',
      markdown: '**接口**：`POST /api/x`\n**状态**：HTTP 500\n附加说明一行',
      buttons: [{ text: '看日志', url: 'https://example.com/logs' }],
    }, { fetchImpl: fn })

    const p = calls[0]!.payload as {
      msgtype: string
      template_card: {
        main_title: { title: string }
        sub_title_text?: string
        horizontal_content_list?: Array<{ keyname: string; value: string }>
        jump_list?: Array<{ type: number; url: string; title: string }>
        card_action: { type: number; url: string }
      }
    }
    expect(p.msgtype).toBe('template_card')
    expect(p.template_card.main_title.title).toBe('接口异常')
    // 「**键**：值」抽成键值区，反引号被清掉（企微键值区不渲染 markdown）
    expect(p.template_card.horizontal_content_list).toEqual([
      { keyname: '接口', value: 'POST /api/x' },
      { keyname: '状态', value: 'HTTP 500' },
    ])
    // 抽不出键值的行不丢，留在副标题
    expect(p.template_card.sub_title_text).toContain('附加说明一行')
    expect(p.template_card.jump_list?.[0]).toEqual({ type: 1, url: 'https://example.com/logs', title: '看日志' })
    // card_action 是企微必填
    expect(p.template_card.card_action.url).toBe('https://example.com/logs')
  })

  it('没有按钮时 card_action 仍然有值 —— 缺了企微会拒收', async () => {
    const { fn, calls } = mockFetch([{ status: 200, body: { errcode: 0 } }])
    await wecom.card(WECOM_HOOK, { title: 'T', markdown: '正文' }, { fetchImpl: fn })
    const p = calls[0]!.payload as { template_card: { card_action?: { url: string } } }
    expect(p.template_card.card_action?.url).toBeTruthy()
  })

  it('renderMarkdown 仍可用于纯文本场景：标题变加粗、按钮变链接行', () => {
    const md = renderMarkdown({
      title: '接口异常',
      markdown: '状态：500',
      buttons: [{ text: '看日志', url: 'https://example.com/logs' }],
    })
    expect(md).toContain('**接口异常**')
    expect(md).toContain('状态：500')
    expect(md).toContain('[看日志](https://example.com/logs)')
  })
})

describe('边界', () => {
  it('url 为空直接返回失败，不发请求', async () => {
    const { fn, calls } = mockFetch([{ status: 200, body: { code: 0 } }])
    const r = await feishu.text('', 'hi', { fetchImpl: fn })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('url')
    expect(calls.length).toBe(0)
  })
})
