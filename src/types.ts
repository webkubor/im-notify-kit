/**
 * 公共类型。
 *
 * 设计前提：这个包只做「把消息发出去」。读配置、写日志、存去重状态都不碰——
 * 那些每个项目的存储都不一样（Supabase / KV / D1 / 内存），塞进来只会逼调用方
 * 迁就包的口味。需要持久化的地方一律走依赖注入（见 DedupeStore）。
 */

/** 支持的 IM 平台 */
export type Platform = 'feishu' | 'wecom'

/** 一次发送的结果。永远返回结果对象，不靠抛异常表达「没发成功」。 */
export interface SendResult {
  /** 真的送达才 true：HTTP 2xx **且** 平台业务码为 0 */
  ok: boolean
  /** 实际发生的 HTTP 状态码；网络层就失败时为 0 */
  httpStatus: number
  /**
   * 平台业务码。飞书是 body.code，企微是 body.errcode。
   * undefined 表示响应不是 JSON 或没带业务码（不判定为失败，按 HTTP 状态走）。
   */
  code?: number
  /** 平台返回的原始响应体（截断到 500 字），排查用 */
  response: string
  /** 实际尝试次数（含第一次）。1 表示一次就成了。 */
  attempts: number
  /** 失败原因的人话描述；ok 为 true 时为空 */
  error?: string
  /** 被去重拦下时为 true —— 这不是失败，是「刚推过，故意不推」 */
  deduped?: boolean
}

/** 发送选项 */
export interface SendOptions {
  /**
   * 失败重试次数（不含第一次）。默认 2，即最多发 3 次。
   * 只重试「可能是暂时的」失败：网络异常、超时、HTTP 5xx、飞书 9499 这类限流码。
   * 参数错、机器人被移出群这种重试一万次也一样的，直接放弃。
   */
  retries?: number
  /** 每次尝试的超时（毫秒）。默认 10000。挂在 OS 层 TCP 超时上是不可接受的。 */
  timeoutMs?: number
  /** 重试基础退避（毫秒），实际等待为 base * 2^(n-1)。默认 500。 */
  retryBaseMs?: number
  /** 注入 fetch。默认用全局 fetch；测试和特殊运行时可替换。 */
  fetchImpl?: typeof fetch
  /** 去重：同一 key 在窗口期内只发一次。不传则不去重。 */
  dedupe?: DedupeOptions
}

/** 去重配置 */
export interface DedupeOptions {
  /** 去重键。同一个键在窗口期内只发一次，例如 `api-alert:/api/feedback:500`。 */
  key: string
  /** 窗口期（毫秒）。默认 15 分钟。 */
  windowMs?: number
  /**
   * 去重状态存哪。默认内存 —— 注意 Cloudflare Workers / Lambda 每次请求都可能是
   * 新 isolate，内存 Map 撑不过一次请求，那种环境必须注入外部存储（KV / 数据库）。
   */
  store?: DedupeStore
}

/**
 * 去重存储接口。实现它就能把去重状态放进任何地方。
 *
 * 语义：`shouldSend` 返回 true 表示「该发」；发成功后调用方会调 `markSent`。
 * 查询失败时实现应返回 true —— 宁可多发一条，也不要因为查不到就静默丢掉告警。
 */
export interface DedupeStore {
  shouldSend(key: string, windowMs: number): Promise<boolean> | boolean
  markSent(key: string, windowMs: number): Promise<void> | void
}

/** 飞书卡片主题色 */
export type CardTemplate =
  | 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow'
  | 'orange' | 'red' | 'carmine' | 'violet' | 'purple'
  | 'indigo' | 'grey'

/** 卡片上的按钮 */
export interface CardButton {
  text: string
  url: string
  /** 按钮样式，默认 default */
  type?: 'default' | 'primary' | 'danger'
}

/** 平台中立的消息描述——同一份内容能渲染成飞书卡片，也能渲染成企微 markdown */
export interface NotifyMessage {
  /** 标题。飞书渲染成卡片头，企微拼成 markdown 首行加粗。 */
  title?: string
  /** 正文，markdown 语法 */
  markdown: string
  /** 主题色，只对飞书卡片生效 */
  template?: CardTemplate
  /** 底部按钮，只对飞书卡片生效（企微 markdown 不支持按钮，会降级成正文里的链接行） */
  buttons?: CardButton[]
}

/** 一个推送目标 */
export interface Target {
  platform: Platform
  /** 群机器人的 webhook 地址 */
  url: string
  /** 可选的目标名，只用于结果标注和排查，例如群名 */
  name?: string
}

/** 多目标发送的单条结果 */
export interface FanoutResult extends SendResult {
  target: Target
}
