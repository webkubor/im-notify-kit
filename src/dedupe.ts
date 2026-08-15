import type { DedupeOptions, DedupeStore } from './types.js'

export const DEFAULT_WINDOW_MS = 15 * 60 * 1000

/**
 * 默认的内存去重存储。
 *
 * 够用的场景：常驻进程（Node 服务、CLI、定时任务）。
 * **不**够用的场景：Cloudflare Workers / Pages Functions / Lambda —— 每次请求都可能
 * 是新 isolate，模块级 Map 撑不过一次请求，去重等于没开。那种环境必须注入
 * 外部存储（KV / D1 / 数据库），见 README 的「无状态运行时」一节。
 */
export function memoryStore(): DedupeStore {
  const seen = new Map<string, number>()
  return {
    shouldSend(key, windowMs) {
      const at = seen.get(key)
      if (at === undefined) return true
      if (Date.now() - at >= windowMs) return true
      return false
    },
    markSent(key) {
      seen.set(key, Date.now())
      // 顺手清掉过期项，别让长期运行的进程把 Map 撑爆
      if (seen.size > 1000) {
        const now = Date.now()
        for (const [k, t] of seen) if (now - t > DEFAULT_WINDOW_MS * 4) seen.delete(k)
      }
    },
  }
}

/** 进程内共享的默认 store —— 不传 store 时用它，保证同一进程内去重真的生效 */
const sharedMemoryStore = memoryStore()

export interface DedupeGate {
  /** 这次该不该发 */
  allowed: boolean
  /** 发成功后调它打标记。失败别调——一次失败堵死整个窗口期的告警是最糟的结果。 */
  mark(): Promise<void>
}

export async function resolveDedupe(options: DedupeOptions): Promise<DedupeGate> {
  const { key, windowMs = DEFAULT_WINDOW_MS, store = sharedMemoryStore } = options
  let allowed: boolean
  try {
    allowed = await store.shouldSend(key, windowMs)
  } catch {
    // 查不到就放行：宁可多推一条，也不要因为存储抖动静默吞掉告警
    allowed = true
  }
  return {
    allowed,
    async mark() {
      try { await store.markSent(key, windowMs) } catch { /* 打标记失败最多多推一条，不该影响发送结果 */ }
    },
  }
}
