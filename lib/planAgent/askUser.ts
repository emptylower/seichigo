import type { TripPlanMetaUpdate } from '@/lib/tripPlan/repo'

export type AskUserKind = 'date_range' | 'single_choice' | 'multi_choice'

export const ASK_USER_KINDS: AskUserKind[] = ['date_range', 'single_choice', 'multi_choice']

export type AskUserOption = {
  id: string
  label: string
  sublabel?: string
  image?: string
}

/**
 * ask_user 发出的完整提问载荷。SSE 的 ask 事件与 TripPlanMessage(kind='ask')
 * 的 content 与它同构——前端刷新后靠落库的这条消息重建"待回答的结构化问题"。
 */
export type AskUserPayload = {
  askId: string
  kind: AskUserKind
  prompt: string
  options?: AskUserOption[]
  allowSkip?: boolean
}

/**
 * ask_user 的执行方式与其它工具相反：不是"执行完把结果拼回消息数组继续跑"，
 * 而是要中断整个 agent 循环、把控制权交回用户。参考 RunFencedError 的模式，
 * 用异常从任意调用深度冒泡回 loop.ts 顶层，由循环捕获后走专门的收尾分支
 * （发 ask 事件 + 落库，然后正常结束本轮），绝不能被当成工具执行失败。
 */
export class AskUserSignal extends Error {
  readonly payload: AskUserPayload

  constructor(payload: AskUserPayload) {
    super(`ask_user awaiting structured answer (${payload.askId})`)
    this.name = 'AskUserSignal'
    this.payload = payload
  }
}

/**
 * 用户通过结构化组件提交的回答 → 计划元信息直写补丁。
 * 路由在启动 agent 循环前优先用它写入（走 *IfActive 栅栏路径），让后续
 * LLM 一进来就能看到"startDate/dayCount 已确定"，不用再从自由文本里猜。
 * 选择类回答（optionId/optionIds）与无法识别的形状返回 null，交给模型
 * 结合人类可读文本自行处理。
 */
export function planMetaFromAnswer(answerTo: unknown, answerValue: unknown): TripPlanMetaUpdate | null {
  if (typeof answerTo !== 'string' || !answerTo.trim()) return null
  if (typeof answerValue !== 'object' || answerValue === null || Array.isArray(answerValue)) return null
  const value = answerValue as Record<string, unknown>

  const patch: TripPlanMetaUpdate = {}
  if (typeof value.startDate === 'string' && value.startDate.trim()) {
    const parsed = new Date(value.startDate)
    if (!Number.isNaN(parsed.getTime())) patch.startDate = parsed
  }
  if (Number.isFinite(Number(value.dayCount))) {
    patch.dayCount = Math.min(30, Math.max(1, Math.floor(Number(value.dayCount))))
  }
  return patch.startDate !== undefined || patch.dayCount !== undefined ? patch : null
}
