import type { CardButton, CardTemplate, NotifyMessage, SendOptions, SendResult } from './types.js'
import { postWebhook } from './send.js'

/** 纯文本消息 */
export function text(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return postWebhook('feishu', url, { msg_type: 'text', content: { text: content } }, options)
}

/**
 * 构造飞书交互卡片的 payload。
 *
 * 单独导出是因为有些调用方要自己拿 payload 去走别的通道（比如飞书开放平台
 * API 而不是群机器人 webhook），不该逼他们重拼一遍。
 */
export function buildCard(msg: NotifyMessage): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [
    { tag: 'markdown', content: msg.markdown },
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
  const card: Record<string, unknown> = { elements }
  if (msg.title) {
    card.header = {
      title: { tag: 'plain_text', content: msg.title },
      template: (msg.template ?? 'blue') satisfies CardTemplate,
    }
  }
  return { msg_type: 'interactive', card }
}

/** 交互卡片消息 */
export function card(url: string, msg: NotifyMessage, options?: SendOptions): Promise<SendResult> {
  return postWebhook('feishu', url, buildCard(msg), options)
}
