/**
 * 飞书开放平台 im/v1/messages 应用消息发送层。
 *
 * 与 feishu.ts 的区别：
 * - feishu.ts 走群机器人 webhook，单向推送，URL 是群机器人 token 路径；
 * - feishu-app 走开放平台 API（POST /im/v1/messages），需要 tenant_access_token，
 *   可私聊（open_id / email / union_id）可群发（chat_id）。
 *   适合「给 owner 私聊告警」「按用户身份回复业务问题」这类有身份语义的场景。
 *
 * 用法：
 *   await feishuApp.text('t-xxx', 'open_id_xxx', 'hello', 'open_id', { retries: 1 })
 *   await feishuApp.card('t-xxx', 'open_id_xxx', msg, 'open_id')
 *
 * 与 feishu.webhook 共享 buildCard：内容渲染逻辑一致，仅发送通道不同。
 */
import type { FeishuAppReceiveIdType, NotifyMessage, SendOptions, SendResult } from './types.js'
import { buildCard } from './feishu.js'
import { failResult, sendPayload } from './send.js'

const FEISHU_OPEN_API = 'https://open.feishu.cn'
const MAX_TEXT_LEN = 8000

const RECEIVE_ID_TYPES: readonly FeishuAppReceiveIdType[] = ['open_id', 'chat_id', 'email', 'union_id']

/** 校验 feishu-app 必需的 target 字段。失败返回 ok=false 结果，不抛。 */
function checkTarget(
  accessToken: string | undefined,
  receiveId: string | undefined,
  receiveIdType: string | undefined,
): SendResult | null {
  if (!accessToken) return failResult('feishu-app: appAccessToken 必填')
  if (!receiveId) return failResult('feishu-app: appReceiveId 必填')
  if (!receiveIdType) return failResult('feishu-app: appReceiveIdType 必填')
  if (!(RECEIVE_ID_TYPES as readonly string[]).includes(receiveIdType)) {
    return failResult(`feishu-app: appReceiveIdType 非法值 ${receiveIdType}`)
  }
  return null
}

/**
 * 给任意 fetch 实现包一层 Authorization 头。
 *
 * 注意包在**最终选定的 fetch 外面**（包括调用方注入的 fetchImpl）——只包默认 fetch
 * 的话，注入 fetchImpl 的测试 / 特殊运行时会整个跳过鉴权，带着 401 出门。
 */
function withAuth(base: typeof fetch, accessToken: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return base(input, { ...init, headers })
  }
}

/** 选最终 fetch（注入的优先），并确保它带鉴权头；运行时没有 fetch 时交给 sendPayload 报错 */
function authedFetch(options: SendOptions | undefined, accessToken: string): typeof fetch {
  const base = options?.fetchImpl ?? globalThis.fetch
  return typeof base === 'function' ? withAuth(base, accessToken) : base
}

function messageUrl(receiveIdType: FeishuAppReceiveIdType): string {
  return `${FEISHU_OPEN_API}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`
}

/** 应用消息纯文本。需要可交互内容时用 card()。 */
export function text(
  accessToken: string,
  receiveId: string,
  content: string,
  receiveIdType: FeishuAppReceiveIdType = 'open_id',
  options?: SendOptions,
): Promise<SendResult> {
  const err = checkTarget(accessToken, receiveId, receiveIdType)
  if (err) return Promise.resolve(err)
  return sendPayload(
    'feishu-app',
    messageUrl(receiveIdType),
    {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: String(content).slice(0, MAX_TEXT_LEN) }),
    },
    { ...options, fetchImpl: authedFetch(options, accessToken) },
  )
}

/**
 * 应用消息交互卡片。复用 feishu.buildCard 渲染内容，仅替换发送通道与鉴权头。
 *
 * 注意：飞书应用 API 的 content 字段是卡片 JSON 字符串（不带外层 msg_type 包裹），
 * 与 webhook 的 { msg_type, card } 形态不同——这里取出 buildCard 返回对象的 .card。
 */
export function card(
  accessToken: string,
  receiveId: string,
  msg: NotifyMessage,
  receiveIdType: FeishuAppReceiveIdType = 'open_id',
  options?: SendOptions,
): Promise<SendResult> {
  const err = checkTarget(accessToken, receiveId, receiveIdType)
  if (err) return Promise.resolve(err)
  return sendPayload(
    'feishu-app',
    messageUrl(receiveIdType),
    {
      receive_id: receiveId,
      msg_type: 'interactive',
      content: JSON.stringify(buildCard(msg).card),
    },
    { ...options, fetchImpl: authedFetch(options, accessToken) },
  )
}
