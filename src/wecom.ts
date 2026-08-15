import type { NotifyMessage, SendOptions, SendResult } from './types.js'
import { postWebhook } from './send.js'

/** 纯文本消息 */
export function text(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return postWebhook('wecom', url, { msgtype: 'text', text: { content } }, options)
}

/** markdown 消息 */
export function markdown(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return postWebhook('wecom', url, { msgtype: 'markdown', markdown: { content } }, options)
}

/**
 * 把平台中立的消息渲染成企微 markdown。
 *
 * 企微没有卡片头也不支持按钮，所以：标题降级成首行加粗，按钮降级成末尾的链接行。
 * 降级而不是丢弃——同一条通知发到两个平台时，企微那边不该少信息。
 */
export function renderMarkdown(msg: NotifyMessage): string {
  const parts: string[] = []
  if (msg.title) parts.push(`**${msg.title}**`)
  parts.push(msg.markdown)
  if (msg.buttons?.length) {
    parts.push(msg.buttons.map((b) => `[${b.text}](${b.url})`).join(' · '))
  }
  return parts.join('\n\n')
}

/** 用平台中立消息发企微 markdown */
export function card(url: string, msg: NotifyMessage, options?: SendOptions): Promise<SendResult> {
  return markdown(url, renderMarkdown(msg), options)
}
