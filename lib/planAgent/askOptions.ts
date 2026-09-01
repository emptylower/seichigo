import type { PlanAgentToolDeps } from './tools'
import {
  ASK_USER_MAX_MODEL_OPTIONS,
  isKnownSafeOptionImageSource,
  isSafeAskOptionImageUrl,
  reservedCustomOption,
  type AskUserOption,
} from './askUser'
import type { WorkCover } from './coverImage'

/**
 * ask_user 选项的解析 + 证据契约（M3 修订 + 任务类型分流）。
 *
 * 契约：非自定义选项要么带齐三件套出处（sourceKind + sourceUrl + fetchedAt），
 * 要么是 search_anime/Bangumi 支撑的 bangumiId 选项（服务端自动补规范出处），
 * 要么显式声明 preferenceOnly（纯偏好类，无外部事实）。图片另受安全门约束。
 * 历史 ask 载荷不受影响——这里是"发起新 ask"时的服务端门，不是渲染门。
 *
 * 任务类型（taskType）：
 * - work_selection：保留作品封面阶梯、图片安全检查与 bangumiId 规范来源；
 *   不追加保留的自定义选项——作品卡保持既有交互，自由文本回答由全局
 *   输入框（answerTo + {custom}）兜底（最终澄清 2026-09-01）；
 * - opinion：纯文本意见选项——不解析封面、拒绝 bangumiId/image 等作品媒体
 *   字段，避免意见题再次进入作品媒体语义；出处三件套契约不变；仅意见题
 *   在末位追加保留的 __custom__ 自定义输入选项。
 */

export type AskOptionGateError = { error: string; invalidOptions?: string[] }

/** 选择类提问的任务类型（date_range 不带 options，不进本门） */
export type AskChoiceTaskType = 'work_selection' | 'opinion'

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

export function isAskOptionGateError(value: unknown): value is AskOptionGateError {
  return typeof value === 'object' && value !== null && 'error' in value
}

// ---------------------------------------------------------------------------
// 真实引用来源门控（值本身必须可解析、合理——存在性检查之外防伪造）
// ---------------------------------------------------------------------------

/** 站内数据源的稳定标识前缀（非 URL 形态的可审计出处） */
const STABLE_ID_PREFIXES = ['anitabi:', 'anime:', 'bgm:'] as const
const STABLE_ID_BODY_PATTERN = /^[A-Za-z0-9_\-:.]+$/
const SECRET_URL_PARAM_PATTERN = /^(key|apikey|api_key|token|secret|signature|client_secret)$/i
/** ISO 日期或日期时间（date-only / T 或空格分隔 / 可选秒与毫秒 / Z 或 ±hh:mm） */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/
/** fetchedAt 合理窗口：不早于站点有数据以来，不晚于现在+24h（防伪造未来时间戳） */
const FETCHED_AT_EARLIEST_MS = Date.UTC(2024, 0, 1)
const FETCHED_AT_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

/** fetchedAt 必须是可解析且落在合理窗口内的 ISO 时间戳 */
export function isValidProvenanceFetchedAt(raw: string | undefined): boolean {
  if (!raw) return false
  const value = raw.trim()
  if (!ISO_TIMESTAMP_PATTERN.test(value)) return false
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return false
  const now = Date.now()
  return ms >= FETCHED_AT_EARLIEST_MS && ms <= now + FETCHED_AT_FUTURE_SKEW_MS
}

/**
 * sourceUrl 必须是干净的 http/https URL（无凭据、无明显 key/token 参数——
 * Google Maps URI 的 q=place_id:... 属合法），或站内稳定标识
 * （anitabi:bangumi:1 / anime:bangumi:1 / bgm:subject:1 等现有形态）。
 */
export function isValidProvenanceSourceUrl(raw: string | undefined): boolean {
  if (!raw) return false
  const value = raw.trim()
  if (!value || value.length > 500) return false
  for (const prefix of STABLE_ID_PREFIXES) {
    if (value.startsWith(prefix)) return STABLE_ID_BODY_PATTERN.test(value.slice(prefix.length))
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false
    for (const key of url.searchParams.keys()) {
      if (SECRET_URL_PARAM_PATTERN.test(key)) return false
    }
    return true
  } catch {
    return false
  }
}

/** bangumiId 选项的规范出处（站内点位库数据，与封面补齐无关、恒可补） */
function canonicalBangumiProvenance(bangumiId: number, fetchedAt: string): Pick<AskUserOption, 'sourceKind' | 'sourceUrl' | 'fetchedAt'> {
  return { sourceKind: 'anitabi', sourceUrl: `anitabi:bangumi:${bangumiId}`, fetchedAt }
}

/**
 * 解析并校验模型选项。成功返回追加自定义选项后的完整列表；
 * 失败返回结构化中文错误（模型可自纠重试）。
 */
export async function buildValidatedAskOptions(
  rawOptions: unknown[],
  deps: Pick<PlanAgentToolDeps, 'resolveOptionCover'>,
  taskType: AskChoiceTaskType,
): Promise<AskUserOption[] | AskOptionGateError> {
  if (!rawOptions.length) return { error: 'single_choice/multi_choice 必须提供非空 options 列表' }
  // 上限收紧到 19：意见题末位要保留系统追加的"自行输入"选项（总上限 20）；
  // 作品题不追加自定义项，但沿用同一上限保持契约简单
  if (rawOptions.length > ASK_USER_MAX_MODEL_OPTIONS) {
    return {
      error:
        taskType === 'opinion'
          ? `options 过多（模型最多提供 ${ASK_USER_MAX_MODEL_OPTIONS} 个，系统会自动追加"自行输入"选项）`
          : `options 过多（模型最多提供 ${ASK_USER_MAX_MODEL_OPTIONS} 个）`,
    }
  }

  const options: AskUserOption[] = []
  // opinion 任务门：意见题的选项是纯文本方案/偏好，不得携带作品媒体字段
  const opinionErrors: string[] = []
  for (const rawOption of rawOptions) {
    const option = asRecord(rawOption)
    const id = String(option.id ?? '').trim()
    const label = String(option.label ?? '').trim()
    if (!id || !label) return { error: '每个 option 必须带非空 id 与 label' }
    if (taskType === 'opinion') {
      if (option.bangumiId !== undefined && option.bangumiId !== null && option.bangumiId !== '') {
        opinionErrors.push(`选项「${label}」携带了 bangumiId——意见类提问（taskType=opinion）的选项是方案/偏好取舍，不是作品；要选作品请改用 taskType=work_selection`)
      }
      if (typeof option.image === 'string' && option.image.trim()) {
        opinionErrors.push(`选项「${label}」携带了 image——意见类提问不渲染封面图；作品封面卡请改用 taskType=work_selection`)
      }
    }
    const bangumiId = Number(option.bangumiId)
    options.push({
      id,
      label,
      ...(typeof option.sublabel === 'string' && option.sublabel.trim() ? { sublabel: option.sublabel.trim().slice(0, 120) } : {}),
      ...(typeof option.image === 'string' && option.image.trim() ? { image: option.image.trim() } : {}),
      ...(Number.isFinite(bangumiId) ? { bangumiId: Math.floor(bangumiId) } : {}),
      ...(option.preferenceOnly === true ? { preferenceOnly: true } : {}),
      ...(typeof option.sourceKind === 'string' && option.sourceKind.trim() ? { sourceKind: option.sourceKind.trim().slice(0, 40) } : {}),
      ...(typeof option.sourceUrl === 'string' && option.sourceUrl.trim() ? { sourceUrl: option.sourceUrl.trim().slice(0, 300) } : {}),
      ...(typeof option.fetchedAt === 'string' && option.fetchedAt.trim() ? { fetchedAt: option.fetchedAt.trim().slice(0, 40) } : {}),
    })
  }
  if (opinionErrors.length) {
    return { error: `选项校验失败：${opinionErrors.join('；')}`, invalidOptions: opinionErrors }
  }

  const fetchedAtNow = new Date().toISOString()

  // bangumiId 选项：服务端补规范出处（三件套缺哪项补哪项，模型给的值保留优先）
  if (taskType === 'work_selection') {
    for (const option of options) {
      if (typeof option.bangumiId !== 'number') continue
      const canonical = canonicalBangumiProvenance(option.bangumiId, fetchedAtNow)
      option.sourceKind = option.sourceKind ?? canonical.sourceKind
      option.sourceUrl = option.sourceUrl ?? canonical.sourceUrl
      option.fetchedAt = option.fetchedAt ?? canonical.fetchedAt
    }
  }

  // 封面补齐（仅作品选择）：作品选项给了 bangumiId 但没图 → 本地封面阶梯（anitabi → anime → bgm）
  if (taskType === 'work_selection' && deps.resolveOptionCover) {
    const toEnrich = options.filter((o) => !o.image && typeof o.bangumiId === 'number').slice(0, 8)
    const covers: Array<WorkCover | null> = await Promise.all(
      toEnrich.map((o) => deps.resolveOptionCover!({ bangumiId: o.bangumiId, label: o.label }).catch(() => null)),
    )
    for (let i = 0; i < toEnrich.length; i++) {
      const cover = covers[i]
      if (!cover) continue
      const target = options.find((o) => o.id === toEnrich[i]!.id)
      if (!target || target.image) continue
      target.image = cover.image
      target.imageSource = cover.source
      target.imageAttribution = cover.attribution ?? undefined
      if (!target.sourceKind) target.sourceKind = cover.source
      if (!target.sourceUrl) target.sourceUrl = cover.sourceUrl ?? undefined
    }
  }

  // 证据门：图片安全 + 出处三件套/偏好豁免
  const gateErrors: string[] = []
  for (const option of options) {
    if (option.image !== undefined) {
      if (!isSafeAskOptionImageUrl(option.image)) {
        gateErrors.push(`选项「${option.label}」的图片 URL 不安全（必须 http/https 或站内相对路径，且不能携带 key/token 参数）`)
        continue
      }
      if (
        !isKnownSafeOptionImageSource(option.image) &&
        !option.sourceKind &&
        !option.sourceUrl &&
        !option.imageSource
      ) {
        gateErrors.push(
          `选项「${option.label}」的外部图片缺少来源（sourceKind/sourceUrl）——先由工具取到带出处的数据，不要给无出处的选项配外部图`,
        )
      }
    }
    // 三件套契约：已带出处痕迹或引用外部事实的选项必须带齐；
    // 纯偏好类选项必须显式 preferenceOnly 自证不含外部事实
    const hasAnyProvenance = Boolean(option.sourceKind || option.sourceUrl || option.imageSource)
    if (option.preferenceOnly) {
      if (hasAnyProvenance && !(option.sourceKind && option.sourceUrl && option.fetchedAt)) {
        gateErrors.push(`选项「${option.label}」声明了 preferenceOnly 却又携带出处字段——要么去掉出处字段，要么补齐 sourceKind/sourceUrl/fetchedAt 三件套`)
      }
      continue
    }
    if (typeof option.bangumiId === 'number') {
      // bangumi 选项：canonical 三件套由服务端构造（恒合法）；模型自带的值
      // 也要过值校验（保留优先，但伪造值照样拒绝）
    } else if (!(option.sourceKind && option.sourceUrl && option.fetchedAt)) {
      gateErrors.push(
        `选项「${option.label}」缺少完整出处（sourceKind + sourceUrl + fetchedAt 三者必齐）。外部事实/搜索类选项必须把工具返回的出处原样带上；若是纯偏好类选项（无外部事实），显式加 preferenceOnly: true`,
      )
    }
    // 真实引用来源门控：出处值本身必须可解析、合理（防伪造 sourceUrl/fetchedAt）
    if (option.sourceUrl && !isValidProvenanceSourceUrl(option.sourceUrl)) {
      gateErrors.push(
        `选项「${option.label}」的 sourceUrl 不是合法来源（http/https URL 不能带用户名密码或 key/token 参数；或用站内稳定标识如 anitabi:bangumi:1 / anime:bangumi:1 / bgm:subject:1）——请照抄工具返回值`,
      )
    }
    if (option.fetchedAt && !isValidProvenanceFetchedAt(option.fetchedAt)) {
      gateErrors.push(
        `选项「${option.label}」的 fetchedAt 必须是真实取数时刻的 ISO 时间戳（如 2026-09-01T08:00:00Z）——请照抄工具返回值，不要自行填写`,
      )
    }
  }
  if (gateErrors.length) {
    return { error: `选项校验失败：${gateErrors.join('；')}`, invalidOptions: gateErrors }
  }

  // 末位保留自定义输入选项：仅意见题追加（最终澄清 2026-09-01）——
  // 作品选择卡不渲染自定义卡，自由文本走全局输入框兜底
  if (taskType === 'opinion') {
    options.push(reservedCustomOption())
  }
  return options
}
