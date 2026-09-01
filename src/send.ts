import type { SendOptions, SendResult, Platform } from './types.js'
import { resolveDedupe } from './dedupe.js'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 500

/** 飞书体系平台（webhook 与应用 API 同源：业务码都在 body.code，频控码都是 9499） */
function isFeishuPlatform(platform: Platform): boolean {
  return platform === 'feishu' || platform === 'feishu-app'
}

/** 构造失败结果。本包约定：失败不抛异常，一律返回结果对象。 */
export function failResult(error: string, extra: Partial<SendResult> = {}): SendResult {
  return { ok: false, httpStatus: 0, response: '', attempts: 0, error, ...extra }
}

/**
 * 平台业务码：HTTP 200 不代表送达。
 *
 * 这是这个包存在的头号理由。飞书和企微在「机器人被移出群」「机器人被停用」
 * 「触发群安全设置」「关键词不匹配」这些情况下**照样返回 HTTP 200**，
 * 失败信息藏在 body.code / body.errcode 里。只判断 res.ok 的代码会把这些
 * 当成推送成功——于是告警静默失效：没人收到，也没人知道没收到。
 */
function readBizCode(platform: Platform, body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined
  const o = body as Record<string, unknown>
  const raw = isFeishuPlatform(platform) ? o.code : o.errcode
  return typeof raw === 'number' ? raw : undefined
}

/**
 * 这个失败重试还有意义吗。
 *
 * 重试只对「换个时间点可能就好了」的失败有意义：网络抖动、超时、对面 5xx、被限流。
 * 参数写错、机器人被踢出群、webhook 被吊销这类，重试一万次结果一样，
 * 徒增延迟还把日志刷满。
 */
function isRetryable(platform: Platform, httpStatus: number, code: number | undefined): boolean {
  if (httpStatus === 0) return true            // 网络层异常 / 超时
  if (httpStatus >= 500) return true           // 对面炸了
  if (httpStatus === 429) return true          // 被限流
  if (isFeishuPlatform(platform) && code === 9499) return true   // 飞书频控（webhook + 应用 API 共用）
  if (platform === 'wecom' && code === 45009) return true   // 企微接口调用超限
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 往平台接口 POST 一个 payload，带重试、超时和业务码校验。
 *
 * 这是所有对外发送的唯一出口——feishu.ts / wecom.ts / feishu-app.ts 只负责把内容拼成
 * 各自的 payload 形状，发送语义（什么算成功、什么该重试、等多久）统一收在这里，
 * 不允许各拼各的。
 */
export async function sendPayload(
  platform: Platform,
  url: string,
  payload: unknown,
  options: SendOptions = {},
): Promise<SendResult> {
  const {
    retries = DEFAULT_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    fetchImpl,
    dedupe,
  } = options

  if (!url) {
    return failResult('webhook url 为空')
  }

  // 去重在最前面：被拦下就一次网络请求都不发
  const gate = dedupe ? await resolveDedupe(dedupe) : null
  if (gate && !gate.allowed) {
    return failResult('窗口期内已推送过，本次跳过', { deduped: true })
  }

  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return failResult('当前运行时没有 fetch，请通过 fetchImpl 注入')
  }

  let attempts = 0
  let last: SendResult = failResult('未执行')

  for (let i = 0; i <= retries; i++) {
    attempts++
    let httpStatus = 0
    let text = ''
    let code: number | undefined

    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
      httpStatus = res.status
      text = (await res.text().catch(() => '')).slice(0, 500)

      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { parsed = undefined }
      code = readBizCode(platform, parsed)

      // 没带业务码（非 JSON 响应）时只看 HTTP 状态，不因为解析不出来就判失败
      const bizOk = code === undefined || code === 0
      if (res.ok && bizOk) {
        // 只有真送达才打去重标记。失败也打的话，一次失败就把整个窗口期的告警堵死了。
        if (gate) await gate.mark()
        return { ok: true, httpStatus, code, response: text, attempts }
      }
      last = failResult(
        bizOk ? `HTTP ${httpStatus}` : `平台业务码 ${code}（HTTP ${httpStatus} 但未送达）`,
        { httpStatus, code, response: text, attempts },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      last = failResult(`请求失败：${msg}`, { attempts })
    }

    if (i < retries && isRetryable(platform, httpStatus, code)) {
      await sleep(retryBaseMs * 2 ** i)
      continue
    }
    break
  }

  return last
}

/**
 * @deprecated 改名 `sendPayload` —— 现在它也服务飞书开放平台 API，不再只是 webhook 出口。
 */
export const postWebhook = sendPayload
