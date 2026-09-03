import type OpenAI from 'openai'
import type { LlmClient, LlmClientConfig, LlmChatInput, LlmStreamDelta } from './types'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { LlmEmptyStreamError, LlmHttpError, postJson, readSseDataPayloads } from './http'

type Delta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk

/** DeepSeek 推理模型的非标准扩展字段：流式 chunk 的 delta 上带 reasoning_content。 */
type WithReasoningContent = { reasoning_content?: string | null }

function extractReasoningDelta(delta: Delta): string {
  const value = (delta as WithReasoningContent).reasoning_content
  return typeof value === 'string' ? value : ''
}

type AccumulatedToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
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
    const res = await postJson(
      fetchImpl,
      config.endpointUrl,
      { Authorization: `Bearer ${config.apiKey}` },
      {
        model: input.model,
        max_tokens: input.maxTokens,
        messages: input.messages,
        ...(input.tools?.length ? { tools: input.tools } : {}),
        stream: true,
      },
      input.signal,
    )

    let content = ''
    let reasoning = ''
    let finishReason: string | null | undefined
    const toolCalls = new Map<number, AccumulatedToolCall>()

    const payloadCount = await readSseDataPayloads(res, (payload) => {
      let chunk: Chunk
      try {
        chunk = JSON.parse(payload) as Chunk
      } catch {
        return
      }
      const choice = chunk.choices?.[0]
      if (!choice) return
      const delta = choice.delta
      if (choice.finish_reason) finishReason = choice.finish_reason

      const reasoningDelta = extractReasoningDelta(delta)
      if (reasoningDelta) {
        reasoning += reasoningDelta
        onDelta?.({ reasoning: reasoningDelta })
      }
      if (typeof delta?.content === 'string' && delta.content) {
        content += delta.content
        onDelta?.({ content: delta.content })
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

    if (payloadCount === 0) throw new LlmEmptyStreamError()

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
