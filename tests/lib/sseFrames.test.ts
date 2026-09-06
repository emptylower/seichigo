import { describe, expect, it } from 'vitest'
import { createSseFrameReader } from '@/lib/sseFrames'

const encoder = new TextEncoder()

/** 按给定的字节切片顺序推送（用来构造「一帧被拆到两个 chunk」的场景） */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const event of createSseFrameReader(stream)) out.push(event)
  return out
}

describe('createSseFrameReader（SSE 帧解析，ui.tsx 与观察流共用）', () => {
  it('按空行分帧并解析 data: 载荷', async () => {
    const events = await collect(
      streamOf([`data: ${JSON.stringify({ type: 'ready' })}\n\ndata: ${JSON.stringify({ type: 'done' })}\n\n`]),
    )
    expect(events).toEqual([{ type: 'ready' }, { type: 'done' }])
  })

  it('一帧被拆到多个 chunk 时能拼回来', async () => {
    const events = await collect(streamOf(['data: {"type":"te', 'xt","text":"你好"}', '\n\n']))
    expect(events).toEqual([{ type: 'text', text: '你好' }])
  })

  it('非 data: 行（注释心跳、event: 行）被忽略', async () => {
    const events = await collect(streamOf([': ping\n\nevent: message\n\ndata: {"type":"done"}\n\n']))
    expect(events).toEqual([{ type: 'done' }])
  })

  it('坏 JSON 帧被跳过，后续帧照常解析', async () => {
    const events = await collect(streamOf(['data: {不是 JSON\n\ndata: {"type":"done"}\n\n']))
    expect(events).toEqual([{ type: 'done' }])
  })

  it('流结束时残留的未完整帧不产出事件', async () => {
    const events = await collect(streamOf(['data: {"type":"done"}\n\ndata: {"type":"tex']))
    expect(events).toEqual([{ type: 'done' }])
  })

  it('多字节字符跨 chunk 边界被切开时不乱码', async () => {
    const payload = encoder.encode('data: {"type":"text","text":"宇治"}\n\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // 在 UTF-8 三字节序列中间切一刀
        controller.enqueue(payload.slice(0, 30))
        controller.enqueue(payload.slice(30))
        controller.close()
      },
    })
    expect(await collect(stream)).toEqual([{ type: 'text', text: '宇治' }])
  })
})
