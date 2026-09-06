/**
 * SSE 帧解析（从 `app/(authed)/plan/[id]/ui.tsx` 的 POST 流读循环抽出，纯搬运）：
 * 按空行（`\n\n`）分帧，只取 `data:` 行，JSON 解析失败的帧直接跳过。
 * POST `/agent` 的执行流与 GET `/agent/stream` 的只读观察流共用同一套解析。
 */
export async function* createSseFrameReader(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      // 最后一段可能是被 chunk 边界切断的半帧，留到下一轮拼接
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue
        try {
          yield JSON.parse(line.slice(5)) as unknown
        } catch {
          continue
        }
      }
    }
  } finally {
    // 提前 break（消费方 return）时释放读锁，避免连接悬挂
    reader.releaseLock()
  }
}
