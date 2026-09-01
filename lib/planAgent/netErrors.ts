/**
 * plan agent 的网络瞬时错误识别与用户文案映射。
 *
 * 背景：Cloudflare Workers (workerd) 运行时在出站连接（fetch 到模型 API、
 * TCP socket 到数据库等）被底层中断时抛出平台原生错误，文案为
 * "Network connection lost."——不在任何 JS 依赖源码里（已全文检索验证），
 * 而是内嵌在 workerd 二进制中的运行时字符串。Cloudflare 官方 agents SDK
 * 同样把它归类为"可就地重试的瞬时平台错误"。长推理流式调用（多轮工具
 * 调用 + 7 天行程规模）是整个回合里存活最久的出站连接，最容易撞上。
 */

const TRANSIENT_NETWORK_ERROR_PATTERNS: RegExp[] = [
  // workerd 平台原生（生产案例原文，含句号）
  /network connection lost/i,
  // openai SDK 把连接建立失败包装成 APIConnectionError，默认 message
  /^connection error\.?$/i,
  // undici / Node 系 fetch 包装
  /fetch failed/i,
  // Node socket errno（pg / TCP 直连路径）
  /econnreset|econnrefused|etimedout|epipe|ehostunreach|enetunreach/i,
  // Node http
  /socket hang up/i,
  // pg 连接中断
  /connection terminated|terminated unexpectedly/i,
  /connection closed/i,
]

/** 命中任一已知瞬时网络错误模式（不区分大小写）。 */
function messageLooksTransient(message: string): boolean {
  return TRANSIENT_NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * 判断异常是否为可安全重试的瞬时网络错误。
 *
 * openai SDK 的 APIConnectionError 会把底层 fetch 异常挂在 cause 上
 * （自身 message 只是 "Connection error."），undici 也有 cause 链，
 * 因此沿 cause 链向下找最多 3 层。
 */
export function isTransientNetworkError(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 3 && current; depth++) {
    if (current instanceof Error) {
      if (current.message && messageLooksTransient(current.message)) return true
      current = (current as Error & { cause?: unknown }).cause
    } else {
      return false
    }
  }
  return false
}

/** 瞬时网络错误的用户可见文案（中文，明确告知已保存内容不丢失）。 */
export const AGENT_NETWORK_ERROR_MESSAGE =
  '网络连接不稳定，本轮回复被中断。已完成的规划内容和行程不会丢失，请再发一条消息继续即可。'

/**
 * 统一把 agent 回合里冒泡的异常映射成 SSE error 事件的 message：
 * 瞬时网络错误 → 友好中文；其余 Error → 原样 message（保留 401/配额等
 * 有诊断价值的上游文案）；非 Error 抛出物 → 字符串化。
 */
export function agentErrorMessage(err: unknown): string {
  if (isTransientNetworkError(err)) return AGENT_NETWORK_ERROR_MESSAGE
  if (err instanceof Error) return err.message
  return String(err)
}
