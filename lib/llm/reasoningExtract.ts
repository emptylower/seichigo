/**
 * A2：openai 兼容协议"思考增量"的统一抽取口径（§0 契约 + A2 补充）。
 *
 * 不同供应商把推理过程放在不同字段：DeepSeek 用 delta.reasoning_content、
 * OpenRouter/部分中转用 delta.reasoning（字符串）、OpenAI 官方形态之一是
 * delta.reasoning_details[].text，还有模型直接在 delta.content 里内嵌
 * <think>…</think> 标签。Gemini 官方 OpenAI 兼容端点则是"普通 content 增量
 * + 同 chunk 带 extra_content.google.thought === true 标记"，文本包在
 * <thought>…</thought> 里（</thought> 可能出现在正文第一个 chunk 的开头）。
 * openaiClient 与 planAgent/api.ts 的 env 路径都通过 createReasoningExtractor()
 * 消费 delta，保证任何一家接管都能在思维链里显示思考过程。
 */

/** 各家供应商流式 delta 上可能出现的思考字段（结构宽松，按字段逐个识别）。 */
export type ReasoningDeltaInput = {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  reasoning_details?: Array<{ text?: unknown } | null> | null
  /** Gemini 官方 OpenAI 兼容层：thought === true 时该 chunk 的 content 是思考摘要 */
  extra_content?: { google?: { thought?: unknown } } | null
}

export type ReasoningExtractorChunk = {
  reasoning?: string
  content?: string
}

type Mode = 'outside' | 'think' | 'thought'

/** outside 状态下两个开标签都可能是边界（'<think>' 与 '<thought>' 第 4 个字符分叉，不会同位匹配） */
const OPEN_TAGS = ['<think>', '<thought>']
const CLOSE_TAG: Record<Exclude<Mode, 'outside'>, string> = {
  think: '</think>',
  thought: '</thought>',
}

export function createReasoningExtractor(): {
  consume(delta: ReasoningDeltaInput): ReasoningExtractorChunk
  /** 流结束：把挂起的"疑似半截标签"尾巴按当前状态吐出（只能调一次） */
  flush(): ReasoningExtractorChunk
} {
  let mode: Mode = 'outside'
  let carry = ''

  const candidateTags = (): string[] => (mode === 'outside' ? OPEN_TAGS : [CLOSE_TAG[mode]])

  /** 在 buffer 里找当前状态下最早出现的标签边界；找不到返回 null。 */
  const findTag = (buffer: string): { idx: number; tag: string; next: Mode } | null => {
    const candidates: Array<{ tag: string; next: Mode }> =
      mode === 'outside'
        ? [
            { tag: '<think>', next: 'think' },
            { tag: '<thought>', next: 'thought' },
          ]
        : [{ tag: CLOSE_TAG[mode], next: 'outside' }]
    let best: { idx: number; tag: string; next: Mode } | null = null
    for (const c of candidates) {
      const idx = buffer.indexOf(c.tag)
      if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, tag: c.tag, next: c.next }
    }
    return best
  }

  /**
   * 标签状态机主体：在 buffer 里找当前状态的边界标签；找不到时检查尾部
   * 是否是某个候选标签的前缀（可能被 chunk 切开），是则挂起到 carry 等下一片，
   * 其余部分按当前状态归入 reasoning / content。flagged（Gemini thought:true
   * 标记）时 outside 状态下的正文也归入思考。
   */
  const processContent = (chunk: string, reasoning: string[], content: string[], flagged: boolean): void => {
    let buffer = carry + chunk
    carry = ''
    for (;;) {
      const hit = findTag(buffer)
      if (hit) {
        const before = buffer.slice(0, hit.idx)
        if (before) (mode !== 'outside' || flagged ? reasoning : content).push(before)
        buffer = buffer.slice(hit.idx + hit.tag.length)
        mode = hit.next
        continue
      }
      // 尾部疑似半截标签（最长后缀且是某个候选标签的真前缀）挂起，等下一片判定
      const tags = candidateTags()
      const maxKeep = Math.min(buffer.length, Math.max(...tags.map((t) => t.length)) - 1)
      for (let keep = maxKeep; keep > 0; keep--) {
        const tail = buffer.slice(buffer.length - keep)
        if (tags.some((t) => t.startsWith(tail))) {
          carry = tail
          buffer = buffer.slice(0, buffer.length - keep)
          break
        }
      }
      if (buffer) (mode !== 'outside' || flagged ? reasoning : content).push(buffer)
      return
    }
  }

  return {
    consume(delta: ReasoningDeltaInput): ReasoningExtractorChunk {
      const reasoning: string[] = []
      const content: string[] = []

      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) reasoning.push(delta.reasoning_content)
      if (typeof delta.reasoning === 'string' && delta.reasoning) reasoning.push(delta.reasoning)
      if (Array.isArray(delta.reasoning_details)) {
        for (const detail of delta.reasoning_details) {
          const text = detail && typeof detail === 'object' ? (detail as { text?: unknown }).text : undefined
          if (typeof text === 'string' && text) reasoning.push(text)
        }
      }
      const flagged = delta.extra_content?.google?.thought === true
      if (typeof delta.content === 'string' && delta.content) processContent(delta.content, reasoning, content, flagged)

      const joined = { reasoning: reasoning.join(''), content: content.join('') }
      return {
        ...(joined.reasoning ? { reasoning: joined.reasoning } : {}),
        ...(joined.content ? { content: joined.content } : {}),
      }
    },
    flush(): ReasoningExtractorChunk {
      const tail = carry
      carry = ''
      if (!tail) return {}
      return mode !== 'outside' ? { reasoning: tail } : { content: tail }
    },
  }
}
