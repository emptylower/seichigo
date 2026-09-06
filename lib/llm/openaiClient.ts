import type OpenAI from 'openai'
import type { LlmClient, LlmClientConfig, LlmChatInput, LlmStreamDelta } from './types'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { LlmEmptyStreamError, LlmHttpError, postJson, readSseDataPayloads } from './http'
import { createReasoningExtractor } from './reasoningExtract'
import { GEMINI_THINKING_EXTRA_BODY, isGoogleGeminiOpenAiEndpoint } from './geminiCompat'
import { attachLlmUsage, parseOpenAiUsage, type LlmUsage } from './usage'

type Delta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * F1：已判定不支持 stream_options 的端点（400 且响应体提到该字段）。
 * 模块级记忆——同一端点后续请求直接不带该字段，避免每次都先吃一个 400。
 */
const endpointsWithoutStreamOptions = new Set<string>()

/** F1：400 且响应体文本提到 stream_options（大小写不敏感）才降级重发，其它 400 原样抛出 */
function isStreamOptionsReject(err: unknown): boolean {
  return (
    err instanceof LlmHttpError &&
    err.status === 400 &&
    err.bodySnippet.toLowerCase().includes('stream_options')
  )
}

/**
 * OpenAI 兼容协议客户端：直连用户填写的完整 URL（不走 SDK 的 baseURL
 * 推导），自己解析 SSE。累积逻辑与 lib/planAgent/api.ts 的
 * attemptStreamOnce 完全同构：content / reasoning_content 增量、
 * tool_calls 按 index 归并、finish_reason 取最后一个非空值。
 */
export function createOpenAiCompatibleClient(config: LlmClientConfig): LlmClient {
  const fetchImpl = config.fetchImpl ?? fetch

  async function streamChat(
    input: LlmChatInput,
    onDelta?: (d: LlmStreamDelta) => void,
  ): Promise<PlanAgentChatMessage> {
    // F1：带 stream_options 先试；端点 400 且报文提到该字段 → 记住端点并立即
    // 去掉重发一次。不认该字段的兼容端点不会再每次请求都白吃一个 400。
    const includeStreamOptions = !endpointsWithoutStreamOptions.has(config.endpointUrl)
    const buildBody = (withStreamOptions: boolean) => ({
      model: input.model,
      max_tokens: input.maxTokens,
      messages: input.messages,
      ...(input.tools?.length ? { tools: input.tools } : {}),
      stream: true,
      ...(withStreamOptions ? { stream_options: { include_usage: true } } : {}),
      // A2 补充：仅 Google 官方 OpenAI 兼容端点追加思考回显开关（不与
      // reasoning_effort 同传、不指定 thinking_level）；其它 host 不加任何额外字段
      ...(isGoogleGeminiOpenAiEndpoint(config.endpointUrl)
        ? { extra_body: GEMINI_THINKING_EXTRA_BODY }
        : {}),
    })

    let res: Response
    try {
      res = await postJson(
        fetchImpl,
        config.endpointUrl,
        { Authorization: `Bearer ${config.apiKey}` },
        buildBody(includeStreamOptions),
        input.signal,
      )
    } catch (err) {
      if (includeStreamOptions && isStreamOptionsReject(err)) {
        endpointsWithoutStreamOptions.add(config.endpointUrl)
        res = await postJson(
          fetchImpl,
          config.endpointUrl,
          { Authorization: `Bearer ${config.apiKey}` },
          buildBody(false),
          input.signal,
        )
      } else {
        throw err
      }
    }

    let content = ''
    let reasoning = ''
    let finishReason: string | null | undefined
    let usage: LlmUsage | null = null
    const toolCalls = new Map<number, AccumulatedToolCall>()
    // A2：统一思考增量口径（reasoning_content / reasoning / reasoning_details /
    // content 内嵌 <think> 标签），见 reasoningExtract.ts
    const extractor = createReasoningExtractor()

    // F8：空流判据是"见过带 choices[0] 的 chunk"——只含 usage 的末帧（choices
    // 为空数组）不构成模型产出，不能凭它把连接判成正常响应
    let sawChoice = false
    await readSseDataPayloads(res, (payload) => {
      let chunk: Chunk
      try {
        chunk = JSON.parse(payload) as Chunk
      } catch {
        return
      }
      // 末帧 usage（choices 为空数组）：先于 choice 判空读取，否则会被 return 丢掉
      const parsedUsage = parseOpenAiUsage((chunk as { usage?: unknown }).usage)
      if (parsedUsage) usage = parsedUsage
      const choice = chunk.choices?.[0]
      if (!choice) return
      sawChoice = true
      const delta = choice.delta
      if (choice.finish_reason) finishReason = choice.finish_reason

      const { reasoning: reasoningDelta, content: contentDelta } = extractor.consume(delta ?? {})
      if (reasoningDelta) {
        reasoning += reasoningDelta
        onDelta?.({ reasoning: reasoningDelta })
      }
      if (contentDelta) {
        content += contentDelta
        onDelta?.({ content: contentDelta })
      }
      for (const part of delta?.tool_calls ?? []) {
        const existing = toolCalls.get(part.index)
        if (!existing) {
          toolCalls.set(part.index, {
            id: part.id ?? '',
            type: 'function',
            function: {
              name: part.function?.name ?? '',
              arguments: part.function?.arguments ?? '',
            },
          })
        } else {
          if (part.id) existing.id = part.id
          if (part.function?.name) existing.function.name = part.function.name
          if (part.function?.arguments) existing.function.arguments += part.function.arguments
        }
      }
    })

    if (!sawChoice) throw new LlmEmptyStreamError()

    // 流结束：吐出挂起的"疑似半截 <think> 标签"尾巴（按当前状态归类）
    const tail = extractor.flush()
    if (tail.content) content += tail.content
    if (tail.reasoning) reasoning += tail.reasoning

    const rebuiltToolCalls = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
    const message: PlanAgentChatMessage = {
      role: 'assistant',
      content: content || null,
      refusal: null,
      ...(rebuiltToolCalls.length ? { tool_calls: rebuiltToolCalls } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
    }
    if (usage) attachLlmUsage(message, usage)
    return message
  }

  async function completeText(input: {
    model: string
    system?: string
    prompt: string
    maxTokens: number
    json?: boolean
    temperature?: number
    signal?: AbortSignal
  }): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
      { role: 'user' as const, content: input.prompt },
    ]
    const baseBody = {
      model: input.model,
      max_tokens: input.maxTokens,
      messages,
      stream: false,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    }

    const attempt = (withJson: boolean) =>
      postJson(
        fetchImpl,
        config.endpointUrl,
        { Authorization: `Bearer ${config.apiKey}` },
        { ...baseBody, ...(withJson ? { response_format: { type: 'json_object' } } : {}) },
        input.signal,
      )

    let res: Response
    try {
      res = await attempt(Boolean(input.json))
    } catch (err) {
      // 部分兼容端点不支持 response_format：降级重发一次不带该字段
      if (input.json && err instanceof LlmHttpError && err.status === 400) {
        res = await attempt(false)
      } else {
        throw err
      }
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    return data.choices?.[0]?.message?.content ?? ''
  }

  return { streamChat, completeText }
}
