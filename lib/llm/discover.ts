import type { LlmProtocol } from './types'
import { InputError, normalizeEndpointUrl, validateEndpointUrl } from './handlers/validate'

/**
 * 第七轮 A4：模型发现（sub2api / OpenAI / DeepSeek / Gemini OpenAI 兼容端点 /
 * Anthropic 通用）。把归一后的请求 endpoint 最后一段（/chat/completions 或
 * /messages）换成 /models 去 GET，解析 OpenAI 形（data[].id）或兼容形
 * （models[].name），供面板"拉取模型列表"一键填表。
 */

export type DiscoveredModel = {
  name: string
  contextLength: number | null
  ownedBy?: string
}

export type DiscoverModelsResult =
  | { ok: true; models: DiscoveredModel[]; endpointUrl: string }
  | { ok: false; message: string }

const DEFAULT_TIMEOUT_MS = 15_000
const MODELS_MAX = 200
/** L9：响应体读取上限——超限中止下载并按失败处理，防超大/异常响应占满内存 */
const MAX_BODY_BYTES = 2 * 1024 * 1024
const BODY_TOO_LARGE_MESSAGE = '拉取模型列表失败：模型列表响应体超过 2 MB 上限'

class BodyTooLargeError extends Error {}

/** 归一后的请求 endpoint → 同前缀的模型列表端点（…/v1/chat/completions → …/v1/models）；query 保留 */
export function buildModelsUrl(endpointUrl: string): string {
  const qIndex = endpointUrl.indexOf('?')
  const base = qIndex >= 0 ? endpointUrl.slice(0, qIndex) : endpointUrl
  const query = qIndex >= 0 ? endpointUrl.slice(qIndex) : ''
  return `${base.replace(/\/chat\/completions$/, '/models').replace(/\/messages$/, '/models')}${query}`
}

/** 兼容解析上下文长度：context_length / context_window / max_context_length 任一数字字段 */
function pickContextLength(raw: Record<string, unknown>): number | null {
  for (const key of ['context_length', 'context_window', 'max_context_length']) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value)
  }
  return null
}

function extractRawModels(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  for (const key of ['data', 'models']) {
    if (Array.isArray(record[key])) return record[key] as Array<Record<string, unknown>>
  }
  return []
}

/**
 * L9：限长读取响应体。Content-Length 已声明超限时直接失败（不下载）；
 * 未声明（chunked）则流式累加，累计超过 2 MB 即 cancel 中止下载。返回文本
 * 由调用方解析 JSON。
 */
async function readBodyTextLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BodyTooLargeError()
  }
  const reader = response.body?.getReader()
  if (!reader) return response.text()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function discoverModels(input: {
  protocol: LlmProtocol
  baseUrl: string
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<DiscoverModelsResult> {
  let modelsUrl: string
  let endpointUrl: string
  try {
    endpointUrl = normalizeEndpointUrl(input.protocol, input.baseUrl)
    modelsUrl = validateEndpointUrl(buildModelsUrl(endpointUrl))
  } catch (err) {
    if (err instanceof InputError) return { ok: false, message: err.message }
    return { ok: false, message: '接口地址不合法' }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.protocol === 'anthropic') {
    headers['x-api-key'] = input.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers.Authorization = `Bearer ${input.apiKey}`
  }

  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(modelsUrl, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, message: `拉取模型列表失败：${(err as Error).message ?? String(err)}`.slice(0, 200) }
  }

  if (!response.ok) {
    const snippet = await response.text().catch(() => '')
    // redirect:'manual' 下 3xx 也走这里——网关把 /models 重定向到登录页时给出可读提示
    return {
      ok: false,
      message: `拉取模型列表失败（HTTP ${response.status}）：${snippet.slice(0, 160)}`.slice(0, 300),
    }
  }

  let body: unknown
  try {
    body = JSON.parse(await readBodyTextLimited(response))
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { ok: false, message: BODY_TOO_LARGE_MESSAGE }
    return { ok: false, message: '模型列表响应不是合法 JSON（该地址可能不支持 /models 端点）' }
  }

  const models: DiscoveredModel[] = []
  const seen = new Set<string>()
  for (const raw of extractRawModels(body)) {
    if (!raw || typeof raw !== 'object') continue
    const name =
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const contextLength = pickContextLength(raw)
    const ownedBy = typeof raw.owned_by === 'string' && raw.owned_by ? raw.owned_by : undefined
    models.push({ name, contextLength, ...(ownedBy !== undefined ? { ownedBy } : {}) })
  }
  if (!models.length) {
    return { ok: false, message: '模型列表为空（该地址可能不支持 /models 端点或返回了非预期结构）' }
  }

  models.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: true, models: models.slice(0, MODELS_MAX), endpointUrl }
}
