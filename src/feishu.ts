import type { CardButton, CardTemplate, NotifyMessage, SendOptions, SendResult } from './types.js'
import { sendPayload } from './send.js'

/** 飞书卡片按钮 */
export interface FeishuCardButton {
  tag: 'button'
  text: { tag: 'lark_md'; content: string }
  type: 'default' | 'primary' | 'danger'
  url: string
}

/** 飞书卡片元素：正文 / 分割线 / 按钮行 */
export type FeishuCardElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'action'; actions: FeishuCardButton[] }

/** 飞书交互卡片本体 */
export interface FeishuCard {
  elements: FeishuCardElement[]
  header?: {
    title: { tag: 'plain_text'; content: string }
    template: CardTemplate
  }
}

/** 飞书 webhook 交互卡片 payload */
export interface FeishuCardPayload {
  msg_type: 'interactive'
  card: FeishuCard
}

/** 纯文本消息 */
export function text(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return sendPayload('feishu', url, { msg_type: 'text', content: { text: content } }, options)
}

/**
 * 构造飞书交互卡片的 payload。
 *
 * 单独导出是因为有些调用方要自己拿 payload 去走别的通道（比如飞书开放平台
 * API 而不是群机器人 webhook），不该逼他们重拼一遍。
 *
 * text-only 消息（没传 markdown）也照常渲染——把 text 当卡片正文，webhook 通道不丢内容。
 */
export function buildCard(msg: NotifyMessage): FeishuCardPayload {
  const elements: FeishuCardElement[] = [
    { tag: 'markdown', content: msg.markdown ?? msg.text ?? '' },
  ]
  if (msg.buttons?.length) {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'action',
      actions: msg.buttons.map((b: CardButton) => ({
        tag: 'button',
        text: { tag: 'lark_md', content: b.text },
        type: b.type ?? 'default',
        url: b.url,
      })),
    })
  }
  const card: FeishuCard = { elements }
  if (msg.title) {
    card.header = {
      title: { tag: 'plain_text', content: msg.title },
      template: msg.template ?? 'blue',
    }
  }
  return { msg_type: 'interactive', card }
}

/** 交互卡片消息 */
export function card(url: string, msg: NotifyMessage, options?: SendOptions): Promise<SendResult> {
  return sendPayload('feishu', url, buildCard(msg), options)
}
