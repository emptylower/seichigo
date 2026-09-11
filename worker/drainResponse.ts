/**
 * Phase 1-A（2026-09-11）：读响应体到底的共用小函数。
 *
 * 内部路由用心跳流保持连接，队列消费者（planAgentConsumer.ts）与 DO 派发器
 * （planRunDispatcher.ts）都必须等它自然结束。原实现抽自 planAgentConsumer.ts，
 * 两处共用；本文件保持零 import。
 */
export async function drainBody(res: globalThis.Response): Promise<void> {
  const body = res.body
  if (!body) return
  const reader = body.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
