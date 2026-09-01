import type { TripPlanMetaUpdate } from '@/lib/tripPlan/repo'

export type AskUserKind = 'date_range' | 'single_choice' | 'multi_choice'

export const ASK_USER_KINDS: AskUserKind[] = ['date_range', 'single_choice', 'multi_choice']

/**
 * ask_user 的任务类型（显式语义）：kind 只表达交互基数（日期/单选/多选），
 * taskType 表达"这是在问什么"——选作品与征求方案意见必须是两种不同的
 * 提问，混用会让意见题渲染成作品封面卡（错误视觉 + 错误语义）。
 */
export type AskUserTaskType = 'date_range' | 'work_selection' | 'opinion'

export const ASK_USER_TASK_TYPES: AskUserTaskType[] = ['date_range', 'work_selection', 'opinion']

export function isAskUserTaskType(value: unknown): value is AskUserTaskType {
  return typeof value === 'string' && (ASK_USER_TASK_TYPES as string[]).includes(value)
}

/**
 * 历史落库 ask 载荷（无 taskType）的兼容归一化——只在读取/渲染层使用一次：
 * 1. kind=date_range → date_range；
 * 2. 旧 options（剔除保留自定义项后）全部显式 preferenceOnly 且不带 bangumiId → opinion；
 * 3. 其余旧选择载荷 → work_selection（保证旧作品卡视觉不变）。
 * 旧 M3 意见题落库时已带服务端追加的末位 __custom__（无 preferenceOnly），
 * 判定"全部 preferenceOnly"时必须忽略它，否则刷新后会被误判成作品选择。
 * 新发起的 ask 必须由工具参数显式声明 taskType，服务端门不允许靠此推断。
 */
export function inferLegacyAskTaskType(payload: Pick<AskUserPayload, 'kind' | 'options'>): AskUserTaskType {
  if (payload.kind === 'date_range') return 'date_range'
  const options = (payload.options ?? []).filter((o) => !isAskCustomOption(o))
  const hasBangumi = options.some((o) => typeof o.bangumiId === 'number')
  const allPreferenceOnly = options.length > 0 && options.every((o) => o.preferenceOnly === true)
  if (!hasBangumi && allPreferenceOnly) return 'opinion'
  return 'work_selection'
}

/**
 * 意见选择卡末位固定保留的"自行输入"选项 id。由 ask_user 工具执行器在
 * 服务端追加（仅 taskType=opinion，最终澄清 2026-09-01：作品选择卡不渲染
 * 自定义卡，自由文本走全局输入框兜底），前端据此渲染内联输入框。
 * 历史过渡期落库的 work 载荷可能残留该选项，渲染层必须忽略。
 */
export const ASK_CUSTOM_OPTION_ID = '__custom__'
export const ASK_CUSTOM_OPTION_LABEL = '其他（自行输入）'

/** options 数组的硬上限；意见题模型选项最多 19 个（末位留系统自定义项），作品题沿用同一上限 */
export const ASK_USER_MAX_OPTIONS = 20
export const ASK_USER_MAX_MODEL_OPTIONS = ASK_USER_MAX_OPTIONS - 1

/**
 * 选项的来源溯源字段（M3）：外部事实/生成的选项必须携带可审计的出处。
 * 全部可选——历史 ask 载荷没有这些字段也仍然可渲染。
 * M3 证据契约修订：新生成的非自定义选项必须带齐 sourceKind + sourceUrl +
 * fetchedAt 三件套，或显式声明 preferenceOnly（纯偏好类选项，无外部事实）。
 */
export type AskUserOptionProvenance = {
  /** 来源类型/提供方：anitabi / bangumi / google_places / model 等 */
  sourceKind?: string
  /** 来源 URL 或稳定的提供方标识（不含任何密钥） */
  sourceUrl?: string
  /** 服务端取数时间（ISO 字符串） */
  fetchedAt?: string
  /** 封面图的来源标识 */
  imageSource?: string
  /** 封面图署名/版权提示（纯文本） */
  imageAttribution?: string
}

export type AskUserOption = AskUserOptionProvenance & {
  id: string
  label: string
  sublabel?: string
  image?: string
  /** 作品类选项可携带 bangumiId，服务端据此补齐本地封面与规范出处（不进模型回放） */
  bangumiId?: number
  /** 纯偏好类选项（如"节奏轻松/紧凑"）：不含任何外部事实，可免三件套出处 */
  preferenceOnly?: boolean
}

/** 服务端追加的保留自定义选项（历史载荷里不会出现，新载荷固定在末位） */
export function reservedCustomOption(): AskUserOption {
  return { id: ASK_CUSTOM_OPTION_ID, label: ASK_CUSTOM_OPTION_LABEL }
}

/** 历史与新载荷通用的 isCustom 判定（只认 id，防御性兼容） */
export function isAskCustomOption(option: AskUserOption): boolean {
  return option.id === ASK_CUSTOM_OPTION_ID
}

/**
 * 选项图片的已知安全图源 host（站内封面阶梯的取数域）。相对路径
 * （站内代理如 /api/google/place-photo、/api/anitabi/image-render）视为安全。
 */
export const ASK_OPTION_SAFE_IMAGE_HOSTS = ['anitabi.cn', 'bgm.tv'] as const

const SECRET_QUERY_KEYS = /^(key|apikey|api_key|token|secret)$/i

function parseOptionImageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** 安全都行：非空；站内相对路径（非 // 开头）；或合法 http(s) 绝对 URL 且不带凭据/密钥参数 */
export function isSafeAskOptionImageUrl(raw: string): boolean {
  const value = String(raw || '').trim()
  if (!value) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  const url = parseOptionImageUrl(value)
  if (!url) return false
  if (url.username || url.password) return false
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY_KEYS.test(key)) return false
  }
  return true
}

/** 图片是否来自已知安全图源（安全 host 的绝对 URL 或站内相对路径） */
export function isKnownSafeOptionImageSource(raw: string): boolean {
  const value = String(raw || '').trim()
  if (!value) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  const url = parseOptionImageUrl(value)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return ASK_OPTION_SAFE_IMAGE_HOSTS.some((safe) => host === safe || host.endsWith(`.${safe}`))
}

/**
 * ask_user 发出的完整提问载荷。SSE 的 ask 事件与 TripPlanMessage(kind='ask')
 * 的 content 与它同构——前端刷新后靠落库的这条消息重建"待回答的结构化问题"。
 */
export type AskUserPayload = {
  askId: string
  kind: AskUserKind
  /** 任务类型：date_range 问日期；work_selection 选作品；opinion 征求意见/方案取舍 */
  taskType: AskUserTaskType
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
