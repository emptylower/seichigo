import type OpenAI from 'openai'
import type { LlmClient, LlmClientConfig, LlmChatInput, LlmStreamDelta } from './types'
import type { PlanAgentChatMessage } from '@/lib/planAgent/loop'
import { LlmEmptyStreamError, postJson, readSseDataPayloads } from './http'
import { attachLlmUsage, parseAnthropicUsage, type AnthropicDeltaUsage, type AnthropicStartUsage } from './usage'

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] }

const ANTHROPIC_VERSION = '2023-06-01'

function textOf(content: ChatMessageParam['content'] | null | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
  }
  return ''
}

/**
 * OpenAI 消息形状 → Anthropic Messages API：
 * - system 消息抽出为顶层 system 字符串；
 * - user/assistant 文本 → content blocks（多段文本 part 合并为单 text block，
 *   空字符串文本不产出 block）；
 * - assistant 的 tool_calls → tool_use blocks（input = JSON.parse(arguments)，
 *   解析失败降级 {}）；
 * - role:'tool' 回执 → 紧随其后的 user 消息里的 tool_result blocks，
 *   连续多条 tool 消息合并进同一条 user 消息（Anthropic 要求）；
 * - 转换后 content 为空数组的消息整条丢弃（assistant 无文本无 tool_use、
 *   user 空文本——Anthropic 会 400 拒绝空 content 的消息）。
 */
export function convertMessages(messages: ChatMessageParam[]): {
  system: string | undefined
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []
  let pendingToolResults: AnthropicBlock[] = []

  const flushToolResults = () => {
    if (pendingToolResults.length) {
      out.push({ role: 'user', content: pendingToolResults })
      pendingToolResults = []
    }
  }

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = textOf(msg.content)
      if (text) systemParts.push(text)
      continue
    }
    if (msg.role === 'tool') {
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      pendingToolResults.push({ type: 'tool_result', tool_use_id: msg.tool_call_id, content: text })
      continue
    }
    flushToolResults()
    if (msg.role === 'user') {
      const text = textOf(msg.content)
      if (text) out.push({ role: 'user', content: [{ type: 'text', text }] })
      continue
    }
    if (msg.role !== 'assistant') continue // legacy function 角色不走 Messages API
    const blocks: AnthropicBlock[] = []
    const text = textOf(msg.content)
    if (text) blocks.push({ type: 'text', text })
    for (const call of msg.tool_calls ?? []) {
      if (call.type !== 'function') continue
      let input: unknown = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        input = {}
      }
      blocks.push({ type: 'tool_use', id: call.id, name: call.function.name, input })
    }
    if (!blocks.length) continue
    out.push({ role: 'assistant', content: blocks })
  }
  flushToolResults()

  return {
    system: systemParts.length ? systemParts.join('\n\n') : undefined,
    messages: out,
  }
}

function convertTools(tools: ChatTool[] | undefined) {
  if (!tools?.length) return undefined
  return tools
    .filter((tool): tool is Extract<ChatTool, { type: 'function' }> => tool.type === 'function')
    .map((tool) => ({
      name: tool.function.name,
      description: tool.function.description ?? '',
      input_schema: tool.function.parameters ?? { type: 'object' as const, properties: {} },
    }))
}

function headers(apiKey: string): Record<string, string> {
  return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
}

/** Anthropic Messages API 的 stop_reason → OpenAI finish_reason。 */
function toFinishReason(stopReason: string | null | undefined): string | undefined {
  if (stopReason === undefined) return undefined
  // pause_turn（需要继续轮次）与 max_tokens 同语义：映射成 length 让循环层
  // 按预算耗尽继续处理；refusal 是模型拒绝回答的正常终止 → stop
  if (stopReason === 'max_tokens' || stopReason === 'pause_turn') return 'length'
  if (stopReason === 'tool_use') return 'tool_calls'
  return 'stop'
}

type AnthropicStreamEvent = {
  type: string
  index?: number
  content_block?: { type: string; id?: string; name?: string }
  message?: { usage?: AnthropicStartUsage }
  usage?: AnthropicDeltaUsage
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    thinking?: string
    stop_reason?: string
  }
}

/**
 * Anthropic Messages 协议客户端。流式 SSE 事件（content_block_start /
 * content_block_delta / message_delta）累积回 OpenAI 形状的 assistant
 * 消息：tool_use → tool_calls（arguments 为拼接的 JSON 字符串）、
 * thinking_delta → reasoning、stop_reason → finish_reason。
 */
export function createAnthropicClient(config: LlmClientConfig): LlmClient {
  const fetchImpl = config.fetchImpl ?? fetch

  async function streamChat(
    input: LlmChatInput,
    onDelta?: (d: LlmStreamDelta) => void,
  ): Promise<PlanAgentChatMessage> {
    const { system, messages } = convertMessages(input.messages)
    const tools = convertTools(input.tools)
    const res = await postJson(
      fetchImpl,
      config.endpointUrl,
      headers(config.apiKey),
      {
        model: input.model,
        max_tokens: input.maxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(tools ? { tools } : {}),
        stream: true,
      },
      input.signal,
    )

    let content = ''
    let reasoning = ''
    let finishReason: string | undefined
    let stopReasonRaw: string | undefined
    let startUsage: AnthropicStartUsage | undefined
    let deltaUsage: AnthropicDeltaUsage | undefined
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

    const payloadCount = await readSseDataPayloads(res, (payload) => {
      let event: AnthropicStreamEvent
      try {
        event = JSON.parse(payload) as AnthropicStreamEvent
      } catch {
        return
      }
      if (event.type === 'message_start' && event.message?.usage) {
        startUsage = event.message.usage
        return
      }
      if (event.type === 'message_delta' && event.usage) deltaUsage = event.usage
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        toolCalls.set(event.index ?? toolCalls.size, {
          id: event.content_block.id ?? '',
          name: event.content_block.name ?? '',
          arguments: '',
        })
        return
      }
      if (event.type === 'content_block_delta' && event.delta) {
        if (event.delta.type === 'text_delta' && event.delta.text) {
          content += event.delta.text
          onDelta?.({ content: event.delta.text })
        } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
          const slot = toolCalls.get(event.index ?? 0)
          if (slot) slot.arguments += event.delta.partial_json
        } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          reasoning += event.delta.thinking
          onDelta?.({ reasoning: event.delta.thinking })
        }
        return
      }
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReasonRaw = event.delta.stop_reason
        finishReason = toFinishReason(stopReasonRaw)
      }
    })

    if (payloadCount === 0) throw new LlmEmptyStreamError()

    const rebuiltToolCalls = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      }))

    const message: PlanAgentChatMessage = {
      role: 'assistant',
      // refusal：内容至少为空串而不是 null（下游把它当"模型明确拒绝"处理）
      content: stopReasonRaw === 'refusal' ? content || '' : content || null,
      refusal: null,
      ...(rebuiltToolCalls.length ? { tool_calls: rebuiltToolCalls } : {}),
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
    }
    const usage = parseAnthropicUsage(startUsage, deltaUsage)
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
    // Anthropic 无原生 response_format：翻译提示词本身已要求"只输出 JSON"，
    // 这里不再额外注入指令（保持与原生 Gemini 路径行为一致）。
    const data = (await (
      await postJson(
        fetchImpl,
        config.endpointUrl,
        headers(config.apiKey),
        {
          model: input.model,
          max_tokens: input.maxTokens,
          ...(input.system ? { system: input.system } : {}),
          messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        },
        input.signal,
      )
    ).json()) as { content?: Array<{ type?: string; text?: string }> }
    const textBlocks = (data.content ?? []).filter((block) => block.type === 'text')
    return textBlocks.map((block) => block.text ?? '').join('')
  }

  return { streamChat, completeText }
}
