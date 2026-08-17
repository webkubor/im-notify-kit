/**
 * 飞书开放平台 im/v1/messages 应用消息发送层。
 *
 * 与 feishu.ts 的区别：
 *   - feishu.ts 走群机器人 webhook，单向推送，URL 是群机器人 token 路径；
 *   - feishu-app 走开放平台 API（POST /im/v1/messages），需要 tenant_access_token，
 *     可私聊（open_id / email / union_id）可群发（chat_id）。
 *     适合「给 owner 私聊告警」「按用户身份回复业务问题」这类有身份语义的场景。
 *
 * 用法：
 *   await feishuApp.text('t-xxx', 'open_id_xxx', 'hello', 'open_id', { retries: 1 })
 *   await feishuApp.card('t-xxx', 'open_id_xxx', msg, 'open_id')
 *
 * 与 feishu.webhook 共享 buildCard：内容渲染逻辑一致，仅发送通道不同。
 */
import type { NotifyMessage, SendOptions, SendResult } from './types.js'
import { buildCard } from './feishu.js'
import { postWebhook } from './send.js'

const FEISHU_OPEN_API = 'https://open.feishu.cn'

/** 校验 feishu-app 必需的 target 字段。失败返回 ok=false 结果，不抛。 */
function checkTarget(
  accessToken: string | undefined,
  receiveId: string | undefined,
  receiveIdType: string | undefined,
): SendResult | null {
  if (!accessToken) return { ok: false, httpStatus: 0, response: '', attempts: 0, error: 'feishu-app: appAccessToken 必填' }
  if (!receiveId) return { ok: false, httpStatus: 0, response: '', attempts: 0, error: 'feishu-app: appReceiveId 必填' }
  if (!receiveIdType) return { ok: false, httpStatus: 0, response: '', attempts: 0, error: 'feishu-app: appReceiveIdType 必填' }
  if (!['open_id', 'chat_id', 'email', 'union_id'].includes(receiveIdType)) {
    return { ok: false, httpStatus: 0, response: '', attempts: 0, error: `feishu-app: appReceiveIdType 非法值 ${receiveIdType}` }
  }
  return null
}

/**
 * 应用消息纯文本。markdown 优先：传了 markdown 就走卡片（卡片更显眼），只 text 才是纯文本。
 */
export async function text(
  accessToken: string,
  receiveId: string,
  content: string,
  receiveIdType: 'open_id' | 'chat_id' | 'email' | 'union_id' = 'open_id',
  options?: SendOptions,
): Promise<SendResult> {
  const err = checkTarget(accessToken, receiveId, receiveIdType)
  if (err) return err
  const payload = {
    receive_id: receiveId,
    msg_type: 'text',
    content: JSON.stringify({ text: String(content).slice(0, 8000) }),
  }
  return postWebhook('feishu-app', `${FEISHU_OPEN_API}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, payload, {
    ...options,
    fetchImpl: options?.fetchImpl ?? withAuth(accessToken),
  })
}

/**
 * 应用消息交互卡片。复用 feishu.buildCard 渲染内容，仅替换发送通道与鉴权头。
 *
 * 注意：飞书应用 API 的 content 字段是卡片 JSON 字符串（不带外层 msg_type 包裹），
 * 与 webhook 的 { msg_type, card } 形态不同——这里取出 buildCard 返回对象的 .card。
 */
export async function card(
  accessToken: string,
  receiveId: string,
  msg: NotifyMessage,
  receiveIdType: 'open_id' | 'chat_id' | 'email' | 'union_id' = 'open_id',
  options?: SendOptions,
): Promise<SendResult> {
  const err = checkTarget(accessToken, receiveId, receiveIdType)
  if (err) return err
  const cardPayload = buildCard(msg).card // 去掉 webhook 的 msg_type 包裹，只取卡片本身
  const payload = {
    receive_id: receiveId,
    msg_type: 'interactive',
    content: JSON.stringify(cardPayload),
  }
  return postWebhook('feishu-app', `${FEISHU_OPEN_API}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, payload, {
    ...options,
    fetchImpl: options?.fetchImpl ?? withAuth(accessToken),
  })
}

/** 包一层带 Authorization 头的 fetch（postWebhook 接收 fetchImpl） */
function withAuth(accessToken: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {})
    headers.set('Authorization', `Bearer ${accessToken}`)
    headers.set('Content-Type', 'application/json')
    return globalThis.fetch(input, { ...init, headers })
  }
}