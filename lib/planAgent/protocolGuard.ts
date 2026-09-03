/**
 * M3 强制 ask_user 协议守卫：模型把"需要用户回答的问题"写成普通文字结束语，
 * 用户将拿到一个无法结构化回答的悬空提问。守卫在循环层做一次窄判定，
 * 命中时带纠正指令重试一次模型；再犯则显式报可恢复的协议错误。
 *
 * 判定刻意保守：必须是"向用户要一个答案"的句子（疑问词 + 问号/祈使句式），
 * 纯解释性文字（如"为什么这样排"的陈述式理由）不算。
 */
import type OpenAI from 'openai'

type ChatMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

/** 缺失回执的占位内容：明确告知模型该调用没有被执行，别把幻觉结果当真 */
const ORPHAN_TOOL_CALL_STUB =
  '{"error":"该工具调用未被执行（响应被协议守卫扣下或本轮中断）"}'

/**
 * 通用防线：每次发起模型调用前遍历内存 messages，凡 assistant 带 tool_calls
 * 而其后紧随的 tool 消息未覆盖全部 id 的，为缺失的 id 就地（splice）补一条
 * 占位 tool 回执。无论哪条路径（协议守卫扣下、信号中止、栅栏错误……）留下
 * 悬空 tool_calls，都不会把非法序列发给模型——DeepSeek 会直接以
 * "assistant message with 'tool_calls' must be followed by tool messages" 400 拒掉。
 * 返回同一数组引用，仅供测试断言方便。
 */
export function assertNoOrphanToolCalls(messages: ChatMessageParam[]): ChatMessageParam[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const toolCalls = 'tool_calls' in msg && msg.tool_calls?.length ? msg.tool_calls : null
    if (!toolCalls) continue
    const answered = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j].role === 'tool') {
      answered.add((messages[j] as Extract<ChatMessageParam, { role: 'tool' }>).tool_call_id)
      j++
    }
    const missing = toolCalls.filter((call) => !answered.has(call.id))
    if (!missing.length) continue
    messages.splice(
      j,
      0,
      ...missing.map(
        (call): ChatMessageParam => ({
          role: 'tool',
          tool_call_id: call.id,
          content: ORPHAN_TOOL_CALL_STUB,
        }),
      ),
    )
  }
  return messages
}

/** 疑问/选择标记：半角或全角问号 */
const HAS_QUESTION_MARK = /[?？]/

/** 直接向用户索要信息的祈使/客套疑问句式（请问/麻烦告诉/能否提供…） */
const ASK_DIRECTIVE =
  /(请告诉|请提供|请选择|请确认|请回复|请问|麻烦(你|您)?(告诉|提供|确认|回复)|能否(告诉|提供|告知)|可否(告诉|提供|告知)|告诉我|跟我说|回复我|来选|选一个|任选其一|直接回复)/

/** 句尾的语气疑问词（吗/呢），允许尾随标点 */
const INTERROGATIVE_TAIL = /[吗呢][?？。!！~～]?\s*$/

/** "A 还是 B"二选一句式 */
const CHOICE_PATTERN = /.{0,24}(还是).{0,24}[?？]/

/**
 * 判断一段 assistant 文字是否像"在向用户提问"。
 * 必须同时满足：
 *  1. 含问号/祈使句式/句尾语气词之一（提问信号）；且
 *  2. 指向用户（你/您）或是明确的祈使/二选一句式。
 * 纯解释（无问号、无祈使、无语气词）一律放行。
 */
export function looksLikeUnansweredUserQuestion(content: string): boolean {
  const text = String(content || '').trim()
  if (!text) return false

  const hasQuestionMark = HAS_QUESTION_MARK.test(text)
  const hasDirective = ASK_DIRECTIVE.test(text)
  const hasTail = INTERROGATIVE_TAIL.test(text)
  const hasChoice = CHOICE_PATTERN.test(text)

  const asksUser = /你|您/.test(text)
  return (
    (hasQuestionMark && asksUser) ||
    hasDirective ||
    (hasTail && asksUser) ||
    (hasChoice && asksUser)
  )
}

/** 重试时注入的纠正指令（只进模型消息，不落库、不下发前端） */
export const PROTOCOL_RETRY_INSTRUCTION =
  '（协议提醒）你上一条回复像是在向用户提问，但没有调用 ask_user 工具。' +
  '任何需要用户回答的问题都必须通过 ask_user 工具发起，并显式声明 taskType（问日期用 date_range、选作品用 work_selection、征求出行方式/节奏/预算等意见用 opinion）。' +
  '选择类（single_choice/multi_choice）会渲染成卡片；意见题（opinion）末位自动保留"自行输入"入口，作品选择（work_selection）的自由输入由全局输入框兜底。' +
  '如果刚才确实是在提问，请现在调用 ask_user 重新发起；如果只是解释说明而非提问，请继续正常完成当前任务，不要再重复提问。'

/** 重试后仍违反协议时，下发并落库的可恢复错误文案（前端会附重试入口） */
export const PROTOCOL_ERROR_MESSAGE =
  '规划师刚才把问题直接写成了文字，没有生成可点的回答卡片（协议违规）。' +
  '你可以直接在下方输入框回答刚才的问题，或点"重试"让规划师重新提问。'
