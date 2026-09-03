/**
 * 协议客户端共用的 HTTP / SSE 基建。独立成文件以避免
 * client.ts（分发器）↔ 各协议客户端之间的循环 import。
 */

/**
 * 上游 HTTP 错误：status + body 前 300 字。上层（翻译重试、管理端连通
 * 测试、agent 的重试守卫）据此区分 4xx/5xx，而不是解析自由文本。
 */
export class LlmHttpError extends Error {
  readonly status: number
  readonly bodySnippet: string

  constructor(status: number, bodySnippet: string) {
    super(`LLM API error (${status}): ${bodySnippet.slice(0, 300)}`)
    this.name = 'LlmHttpError'
    this.status = status
    this.bodySnippet = bodySnippet
  }
}

/**
 * 连接建立后立刻关闭、一个 SSE 事件都没产出。与 planAgent/api.ts 内部的
 * EmptyStreamError 同语义：传输层瞬时失败，可安全重试同一次模型调用。
 */
export class LlmEmptyStreamError extends Error {
  constructor() {
    super('模型未返回消息')
    this.name = 'LlmEmptyStreamError'
  }
}

/** 共用的 JSON POST：非 2xx 统一抛 LlmHttpError；3xx 重定向一律拒绝。 */
export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
    ...(signal ? { signal } : {}),
  })
  // 出站请求绝不跟随重定向：30x 的 Location 可能指向内网地址，跟随即绕过
  // SSRF 守卫（端点校验只发生在保存时，不覆盖运行时的跳转目标）
  if (res.status >= 300 && res.status < 400) {
    throw new LlmHttpError(res.status, '上游返回重定向，已拒绝')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new LlmHttpError(res.status, text)
  }
  return res
}

/**
 * 逐行解析 SSE 响应体：只关心 `data:` 载荷行。容忍 \r\n 与事件间空行；
 * 非 data: 行（event:/id:/注释）按规范忽略。返回收到的载荷数，供空流
 * 检测（0 = 连接建立后未产出任何事件）。
 */
export async function readSseDataPayloads(
  res: Response,
  onPayload: (payload: string) => void,
): Promise<number> {
  if (!res.body) throw new LlmEmptyStreamError()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let count = 0

  const handleLine = (line: string) => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!clean.startsWith('data:')) return
    const payload = clean.slice(5).replace(/^ /, '')
    if (!payload || payload === '[DONE]') return
    onPayload(payload)
    count += 1
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      handleLine(line)
    }
  }
  buffer += decoder.decode()
  if (buffer) handleLine(buffer)
  return count
}
