import type { NotifyMessage, SendOptions, SendResult } from './types.js'
import { sendPayload } from './send.js'

/** 纯文本消息 */
export function text(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return sendPayload('wecom', url, { msgtype: 'text', text: { content } }, options)
}

/** markdown 消息 */
export function markdown(url: string, content: string, options?: SendOptions): Promise<SendResult> {
  return sendPayload('wecom', url, { msgtype: 'markdown', markdown: { content } }, options)
}

/**
 * 把平台中立的消息渲染成企微 markdown。
 *
 * 企微 markdown 不支持按钮，所以标题降级成首行加粗、按钮降级成末尾链接行。
 * 降级而不是丢弃——同一条通知发到两个平台时，企微那边不该少信息。
 *
 * 想要可交互卡片用 buildTemplateCard / templateCard，别用这个。
 */
export function renderMarkdown(msg: NotifyMessage): string {
  const parts: string[] = []
  if (msg.title) parts.push(`**${msg.title}**`)
  parts.push(msg.markdown ?? msg.text ?? '')
  if (msg.buttons?.length) {
    parts.push(msg.buttons.map((b) => `[${b.text}](${b.url})`).join(' · '))
  }
  return parts.join('\n\n')
}

/**
 * 从 markdown 正文里抽出「**键**：值」形式的行，转成企微卡片的键值区。
 *
 * 告警类消息的正文本来就是这个形状（接口 / 状态 / 触发用户 / 时间），
 * 企微卡片的 horizontal_content_list 渲染出来比一坨 markdown 好读。
 * 抽不出来的行原样留在副标题里，不丢内容。
 */
function splitKeyValueLines(markdown: string): {
  pairs: Array<{ keyname: string; value: string }>
  rest: string[]
} {
  const pairs: Array<{ keyname: string; value: string }> = []
  const rest: string[] = []
  for (const line of markdown.split('\n')) {
    const t = line.trim()
    if (!t) continue
    // 匹配 **键**：值 / **键**: 值
    const m = /^\*\*(.+?)\*\*\s*[：:]\s*(.+)$/.exec(t)
    if (m && pairs.length < 6) {
      // 企微键值区不渲染 markdown，反引号之类的标记去掉，免得原样显示出来
      pairs.push({ keyname: m[1]!.trim(), value: m[2]!.replace(/`/g, '').trim().slice(0, 200) })
    } else {
      rest.push(t)
    }
  }
  return { pairs, rest }
}

/** 企微模板卡片本体（card_type: text_notice） */
export interface WecomTemplateCard {
  card_type: 'text_notice'
  main_title: { title: string }
  sub_title_text?: string
  horizontal_content_list?: Array<{ keyname: string; value: string }>
  jump_list?: Array<{ type: 1; url: string; title: string }>
  card_action: { type: 1; url: string }
}

/** 企微模板卡片 payload */
export interface WecomTemplateCardPayload {
  msgtype: 'template_card'
  template_card: WecomTemplateCard
}

/** 没有可用跳转地址时的整卡兜底：type:1 + 空 url 会被企微拒收，必须给个真实地址 */
const FALLBACK_CARD_ACTION_URL = 'https://work.weixin.qq.com'

/**
 * 构造企微模板卡片 payload（card_type: text_notice）。
 *
 * 单独导出的理由同飞书的 buildCard：有人要拿 payload 走别的通道，不该逼他重拼。
 *
 * 注意 card_action 是企微的**必填字段**——整卡点击行为。没有按钮时用第一个链接
 * （或调用方给的 fallbackUrl），一个都没有就指向企微官网占位，保证卡片能过审。
 */
export function buildTemplateCard(msg: NotifyMessage, fallbackUrl?: string): WecomTemplateCardPayload {
  const { pairs, rest } = splitKeyValueLines(msg.markdown ?? msg.text ?? '')
  const jumpUrl = msg.buttons?.[0]?.url ?? fallbackUrl

  const card: WecomTemplateCard = {
    card_type: 'text_notice',
    main_title: { title: msg.title ?? '通知' },
    // card_action 必填：有跳转地址就整卡可点，没有就只能给个占位地址
    card_action: jumpUrl ? { type: 1, url: jumpUrl } : { type: 1, url: FALLBACK_CARD_ACTION_URL },
  }
  if (rest.length) card.sub_title_text = rest.join('\n').slice(0, 400)
  if (pairs.length) card.horizontal_content_list = pairs
  if (msg.buttons?.length) {
    card.jump_list = msg.buttons.slice(0, 3).map((b) => ({ type: 1, url: b.url, title: b.text }))
  }

  return { msgtype: 'template_card', template_card: card }
}

/** 发企微模板卡片（可交互，带键值区和跳转按钮） */
export function templateCard(
  url: string,
  msg: NotifyMessage,
  options?: SendOptions & { fallbackUrl?: string },
): Promise<SendResult> {
  return sendPayload('wecom', url, buildTemplateCard(msg, options?.fallbackUrl), options)
}

/**
 * 用平台中立消息发企微。
 *
 * 默认走**模板卡片**——和飞书那边一样是可交互卡片，不再降级成纯 markdown。
 * 需要纯文本渲染时显式调 markdown()。
 */
export function card(url: string, msg: NotifyMessage, options?: SendOptions): Promise<SendResult> {
  return templateCard(url, msg, options)
}
