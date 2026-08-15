import type { FanoutResult, NotifyMessage, SendOptions, Target } from './types.js'
import * as feishu from './feishu.js'
import * as wecom from './wecom.js'

export * from './types.js'
export { feishu, wecom }
export { postWebhook } from './send.js'
export { memoryStore, DEFAULT_WINDOW_MS } from './dedupe.js'
export { buildCard } from './feishu.js'
export { renderMarkdown } from './wecom.js'

/**
 * 把同一条消息发到多个目标，一次拿回全部结果。
 *
 * 并发发送，**永不抛异常**——单个目标失败不影响其它目标，失败信息在对应结果的
 * error 里。调用方拿到的是一份完整战报，而不是「第一个失败就整体炸掉」。
 *
 * 注意去重：dedupe.key 是按调用去重的，多目标共用同一个 key 意味着
 * 「这条消息这个窗口期发过了」，不是「这个群发过了」。要按群去重就分开调用。
 */
export async function notify(
  targets: Target[],
  msg: NotifyMessage,
  options?: SendOptions,
): Promise<FanoutResult[]> {
  return Promise.all(
    targets.map(async (target) => {
      const send = target.platform === 'feishu' ? feishu.card : wecom.card
      const r = await send(target.url, msg, options)
      return { ...r, target }
    }),
  )
}

/** 接口 5xx 告警的入参 */
export interface ApiAlertInfo {
  /** 出问题的接口路径，例如 `/api/feedback` */
  route: string
  /** HTTP 方法 */
  method: string
  /** 状态码 */
  status: number
  /** 服务端返回的错误内容，会截断到 300 字 */
  detail?: string
  /** 触发的用户，排查时很有用 */
  who?: string
  /** 链路 id */
  traceId?: string
  /** 出问题的系统名，进标题，例如「好易美后台」 */
  system?: string
  /** 「去看日志」按钮的地址；不传就不渲染按钮 */
  logUrl?: string
  /** 时区，默认 Asia/Shanghai */
  timeZone?: string
}

/**
 * 接口异常告警——这个包最初就是为它而生的。
 *
 * 几条硬规矩，都是踩出来的：
 *
 * **只推 5xx，不推 4xx**。4xx 是调用方的问题（没登录、参数不对、越权），量大且
 * 多数是正常拒绝，推了只会淹没真问题。5xx 是自己这边炸了，每一条都该有人看。
 *
 * **必须去重**。一个坏接口配合前端轮询，一分钟能发几十次请求。不去重群会被刷爆，
 * 然后所有人把机器人静音——告警就彻底失效，比没有告警更糟。默认按
 * 「route + status」为键、15 分钟窗口。
 *
 * **去重的代价要知道**：故障持续期间群里是安静的。收到一条就得当回事，别等第二条。
 */
export async function apiAlert(
  targets: Target[],
  info: ApiAlertInfo,
  options?: SendOptions,
): Promise<FanoutResult[]> {
  if (info.status < 500) return []

  const now = new Date().toLocaleString('zh-CN', { timeZone: info.timeZone ?? 'Asia/Shanghai' })
  const lines = [
    `**接口**：\`${info.method} ${info.route}\``,
    `**状态**：HTTP ${info.status}`,
    info.detail ? `**返回**：${String(info.detail).slice(0, 300)}` : '',
    info.who ? `**触发用户**：${info.who}` : '',
    info.traceId ? `**trace_id**：\`${info.traceId}\`` : '',
    `**时间**：${now}`,
  ].filter(Boolean)

  const msg: NotifyMessage = {
    title: `🚨 ${info.system ?? '服务'}接口异常 · ${info.route}`,
    template: 'red',
    markdown: lines.join('\n'),
    buttons: info.logUrl ? [{ text: '看 API 日志', url: info.logUrl, type: 'primary' }] : undefined,
  }

  const merged: SendOptions = {
    ...options,
    dedupe: options?.dedupe ?? { key: `api-alert:${info.route}:${info.status}` },
  }
  return notify(targets, msg, merged)
}
