import type { LlmModelConfig, LlmProtocol } from '../types'

/** 输入校验失败（handlers 捕获后 → 400 + 中文文案）。 */
export class InputError extends Error {}

const NAME_MAX = 60
const URL_MAX = 500
const MODEL_NAME_MAX = 100
const MODELS_MAX = 20
const CONTEXT_MIN = 1000
const CONTEXT_MAX = 10_000_000
const MAX_OUTPUT_MIN = 256
const MAX_OUTPUT_MAX = 1_000_000
const API_KEY_MAX = 500
/** P1：单桶价格上限（微美元/百万 token，$100/M）——防手滑多打几个零把计价撑爆 */
const PRICE_PER_M_MAX = 100_000_000

/** IPv4 私网/回环/链路本地/CGNAT 判定（前两个八位组即可判定）。 */
function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return false
}

/**
 * IPv6 字面量展开成 8 组 16 位数值。URL 规范化会把点分 IPv4 映射段写成
 * 十六进制（`::ffff:169.254.169.254` → `::ffff:a9fe:a9fe`），因此这里
 * 同时接受 `::` 压缩与嵌入的十进制 IPv4 末段。解析不了返回 null。
 */
function expandIpv6(host: string): number[] | null {
  let text = host
  const embedded = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (embedded) {
    const octets = embedded[2].split('.').map(Number)
    if (octets.some((o) => o > 255)) return null
    const hex = octets.map((o) => o.toString(16).padStart(2, '0')).join('')
    text = `${embedded[1]}${hex.slice(0, 4)}:${hex.slice(4)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  if (head.some(Number.isNaN) || tail.some(Number.isNaN)) return null
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail]
}

/**
 * SSRF 守卫：host 不得指向本机/私网/链路本地（与 link-preview 同一思路，
 * 管理面板虽是可信输入，仍防误填内网地址导致探测）。
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true

  if (host.includes(':')) {
    const groups = expandIpv6(host)
    if (!groups) return true // 解析不了的 IPv6 字面量按危险拒绝（保守）
    if (groups.every((g) => g === 0)) return true // ::（未指定）
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1 回环
    if ((groups[0] & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地
    if ((groups[0] & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
    // ::ffff:0:0/96 IPv4 映射：低 32 位按 IPv4 规则判（含十六进制形态）
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      return isPrivateIpv4((groups[6] >> 8) & 0xff, groups[6] & 0xff)
    }
    return false
  }

  const parts = host.split('.')
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number)
    if (octets.some((o) => o > 255)) return false
    return isPrivateIpv4(octets[0], octets[1])
  }
  return false
}

export function validateEndpointUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new InputError('请求 URL 必须是字符串')
  const url = raw.trim()
  if (!url) throw new InputError('请求 URL 不能为空')
  if (url.length > URL_MAX) throw new InputError(`请求 URL 长度不能超过 ${URL_MAX}`)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new InputError('请求 URL 格式不合法')
  }
  if (parsed.protocol !== 'https:') throw new InputError('请求 URL 必须以 https:// 开头')
  if (isPrivateHost(parsed.hostname)) throw new InputError('请求 URL 不能指向内网或本机地址')
  return url
}

/**
 * 第七轮 A4（M4 修订）：把用户填的接口地址（可为基地址，如 sub2api 的
 * `https://gw.example.com/v1` 或 Gemini 的 `…/v1beta/openai`）归一成完整
 * 请求 URL。规则：
 * - 先去掉尾部 `/`；
 * - 路径为空或 `/` → 追加 `/v1/chat/completions`（anthropic `/v1/messages`）；
 * - 路径已以 `/chat/completions`（anthropic `/messages`）结尾 → 原样；
 * - 其他非空路径 → **只追加** `/chat/completions`（anthropic `/messages`），
 *   不再插入 `/v1`——`…/v1beta/openai` 归一为 `…/v1beta/openai/chat/completions`，
 *   `…/api` 归一为 `…/api/chat/completions`；
 * - 后缀比较用小写；端口与 query 保留。
 * L7：归一内部即做 https/私网守卫——绕过 validateEndpointUrl 直接调用本函数
 * 也不会把 http:// 或内网地址放行。
 */
export function normalizeEndpointUrl(protocol: LlmProtocol, rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new InputError('接口地址不能为空')
  if (trimmed.length > URL_MAX) throw new InputError(`接口地址长度不能超过 ${URL_MAX}`)
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new InputError('接口地址格式不合法')
  }
  if (parsed.protocol !== 'https:') throw new InputError('接口地址必须以 https:// 开头')
  if (isPrivateHost(parsed.hostname)) throw new InputError('接口地址不能指向内网或本机地址')
  const suffix = protocol === 'openai' ? '/chat/completions' : '/messages'
  let path = parsed.pathname.replace(/\/+$/, '')
  if (!path) {
    path = protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages'
  } else if (!path.toLowerCase().endsWith(suffix)) {
    path += suffix
  }
  return `${parsed.origin}${path}${parsed.search}`
}

export function validateProtocol(raw: unknown): LlmProtocol {
  if (raw === 'openai' || raw === 'anthropic') return raw
  throw new InputError('协议必须是 openai 或 anthropic')
}

export function validateName(raw: unknown): string {
  if (typeof raw !== 'string') throw new InputError('供应商名称必须是字符串')
  const name = raw.trim()
  if (!name) throw new InputError('供应商名称不能为空')
  if (name.length > NAME_MAX) throw new InputError(`供应商名称不能超过 ${NAME_MAX} 字`)
  return name
}

/**
 * P1：价格字段透传校验。undefined/null = 未填（null 视为显式清除，剥掉）；
 * 填了就必须是非负有限数且不超上限。允许只填部分字段（计价层把缺任一个的
 * 配置整体视为未配置回落价格表，这里不做完整性强校验）。
 */
function validatePriceField(item: Record<string, unknown>, key: string, name: string): number | undefined {
  const raw = item[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new InputError(`模型 ${name} 的 ${key} 必须是非负数字`)
  }
  if (raw > PRICE_PER_M_MAX) {
    throw new InputError(`模型 ${name} 的 ${key} 不能超过 ${PRICE_PER_M_MAX}`)
  }
  return raw
}

export function validateModels(raw: unknown): LlmModelConfig[] {
  if (!Array.isArray(raw)) throw new InputError('models 必须是数组')
  if (raw.length < 1) throw new InputError('至少配置一个模型')
  if (raw.length > MODELS_MAX) throw new InputError(`模型数量不能超过 ${MODELS_MAX} 个`)

  const seen = new Set<string>()
  const out: LlmModelConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new InputError('模型配置格式不合法')
    const name = typeof (item as LlmModelConfig).name === 'string' ? (item as LlmModelConfig).name.trim() : ''
    if (!name) throw new InputError('模型名称不能为空')
    if (name.length > MODEL_NAME_MAX) throw new InputError(`模型名称不能超过 ${MODEL_NAME_MAX} 字`)
    if (seen.has(name)) throw new InputError(`模型名称重复：${name}`)
    seen.add(name)

    const contextLength = (item as LlmModelConfig).contextLength
    if (
      typeof contextLength !== 'number' ||
      !Number.isInteger(contextLength) ||
      contextLength < CONTEXT_MIN ||
      contextLength > CONTEXT_MAX
    ) {
      throw new InputError(`模型 ${name} 的上下文长度必须是 ${CONTEXT_MIN}–${CONTEXT_MAX} 的整数`)
    }

    const maxOutputTokens = (item as LlmModelConfig).maxOutputTokens
    if (
      maxOutputTokens != null &&
      (typeof maxOutputTokens !== 'number' ||
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < MAX_OUTPUT_MIN ||
        maxOutputTokens > MAX_OUTPUT_MAX)
    ) {
      throw new InputError(`模型 ${name} 的最大输出必须是 ${MAX_OUTPUT_MIN}–${MAX_OUTPUT_MAX} 的整数`)
    }

    // P1：价格字段（可选）透传
    const priceItem = item as Record<string, unknown>
    const inputMissPerM = validatePriceField(priceItem, 'inputMissPerM', name)
    const inputCacheHitPerM = validatePriceField(priceItem, 'inputCacheHitPerM', name)
    const outputPerM = validatePriceField(priceItem, 'outputPerM', name)
    const price =
      inputMissPerM !== undefined || inputCacheHitPerM !== undefined || outputPerM !== undefined
        ? {
            ...(inputMissPerM !== undefined ? { inputMissPerM } : {}),
            ...(inputCacheHitPerM !== undefined ? { inputCacheHitPerM } : {}),
            ...(outputPerM !== undefined ? { outputPerM } : {}),
          }
        : undefined

    out.push({
      name,
      contextLength,
      ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
      ...(price !== undefined ? { ...price } : {}),
    })
  }
  return out
}

/** PUT 时校验可选 apiKey：undefined/空串 = 不改；非空 = 换 key。 */
export function validateApiKeyForUpdate(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new InputError('API key 必须是字符串')
  const key = raw.trim()
  if (!key) return null
  if (key.length > API_KEY_MAX) throw new InputError(`API key 长度不能超过 ${API_KEY_MAX}`)
  return key
}

export function validateApiKeyForCreate(raw: unknown): string {
  const key = validateApiKeyForUpdate(raw)
  if (!key) throw new InputError('API key 不能为空')
  return key
}

export function validateModelInList(model: unknown, models: LlmModelConfig[], field: string): string {
  if (typeof model !== 'string' || !model.trim()) {
    throw new InputError(`${field} 不能为空`)
  }
  if (!models.some((m) => m.name === model.trim())) {
    throw new InputError(`${field}（${model}）必须在模型列表里`)
  }
  return model.trim()
}
