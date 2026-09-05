import type { LlmClient, LlmProtocol } from './types'
import { createLlmClient } from './client'
import { decryptSecret } from './secretBox'
import type { LlmProviderRepo, LlmProviderRow } from './repo'

export type LlmScope = 'agent' | 'translation'

export type ResolvedLlm = {
  client: LlmClient
  model: string
  maxOutputTokens: number
  providerId: string
  providerName: string
  protocol: LlmProtocol
}

export type ResolveDeps = {
  repo?: LlmProviderRepo
  now?: () => number
}

const CACHE_TTL_MS = 30_000

type CacheEntry = { at: number; value: ResolvedLlm | null }

/**
 * 缓存按 repo 实例隔离：测试各自注入的内存 repo 互不污染（A 的命中不该
 * 被 B 的空表结果覆盖）。缺省 repo（生产 Prisma）用单例 Map；WeakMap 键
 * 是 repo 引用，实例可被回收。invalidate 需要清掉所有实例的缓存，因此
 * 用一个 Set 追踪全部缓存 Map（生产里只有缺省一个，测试里有界）。
 */
const defaultCache = new Map<LlmScope, CacheEntry>()
const repoCaches = new WeakMap<LlmProviderRepo, Map<LlmScope, CacheEntry>>()
const allCaches = new Set<Map<LlmScope, CacheEntry>>([defaultCache])
let warnedTableMissing = false
let defaultRepo: LlmProviderRepo | null = null

function cacheFor(repo: LlmProviderRepo): Map<LlmScope, CacheEntry> {
  let cache = repoCaches.get(repo)
  if (!cache) {
    cache = new Map()
    repoCaches.set(repo, cache)
    allCaches.add(cache)
  }
  return cache
}

/**
 * 管理 API 每次写入后调用：同一隔离体内立即生效，其他隔离体在缓存
 * TTL（30 秒）内生效。
 */
export function invalidateLlmRegistry(): void {
  for (const cache of allCaches) cache.clear()
}

async function getDefaultRepo(): Promise<LlmProviderRepo> {
  if (!defaultRepo) {
    const { prisma } = await import('@/lib/db/prisma')
    const { createPrismaLlmProviderRepo } = await import('./repoPrisma')
    defaultRepo = createPrismaLlmProviderRepo(prisma)
  }
  return defaultRepo
}

function pickTakeoverRow(rows: LlmProviderRow[], scope: LlmScope): LlmProviderRow | null {
  return (
    rows.find(
      (row) =>
        (scope === 'agent' ? row.takeoverAgent : row.takeoverTranslation) &&
        row.enabled &&
        row.apiKeyCiphertext,
    ) ?? null
  )
}

function maxOutputTokensFor(row: LlmProviderRow, model: string): number {
  const config = row.models.find((m) => m.name === model)
  if (config?.maxOutputTokens) return config.maxOutputTokens
  const context = config?.contextLength ?? 128000
  return Math.min(Math.floor(context / 4), 32768)
}

/**
 * 解析某范围当前接管的供应商 → 解密 key → 统一客户端。
 * 返回 null 表示回退环境变量路径（无接管 / 供应商被禁用或无 key /
 * 数据库不可用 / 解密失败）。任何仓储层异常都不允许拖垮调用方。
 */
export async function resolveLlmForScope(
  scope: LlmScope,
  deps?: ResolveDeps,
): Promise<ResolvedLlm | null> {
  const now = deps?.now ?? (() => Date.now())
  const repo = deps?.repo ?? (await getDefaultRepo())
  const cache = cacheFor(repo)
  const hit = cache.get(scope)
  if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value

  let rows: LlmProviderRow[]
  try {
    rows = await repo.list()
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if ((code === 'P2021' || code === 'P2022') && !warnedTableMissing) {
      warnedTableMissing = true
      console.warn('[llm/registry] LlmProvider 表不存在，供应商接管未启用（回退环境变量）')
    } else if (code !== 'P2021' && code !== 'P2022') {
      console.warn('[llm/registry] 读取供应商失败，回退环境变量', err)
    }
    cache.set(scope, { at: now(), value: null })
    return null
  }

  const row = pickTakeoverRow(rows, scope)
  if (!row || !row.apiKeyCiphertext) {
    cache.set(scope, { at: now(), value: null })
    return null
  }

  const scopeModel = scope === 'agent' ? row.agentModel : row.translationModel
  const model = scopeModel ?? row.models[0]?.name
  if (!model) {
    cache.set(scope, { at: now(), value: null })
    return null
  }

  let apiKey: string
  try {
    apiKey = await decryptSecret(row.apiKeyCiphertext)
  } catch (err) {
    console.warn(`[llm/registry] 供应商 ${row.name} 的 key 解密失败，回退环境变量`, err)
    cache.set(scope, { at: now(), value: null })
    return null
  }

  const value: ResolvedLlm = {
    client: createLlmClient({
      protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
      endpointUrl: row.endpointUrl,
      apiKey,
    }),
    model,
    maxOutputTokens: maxOutputTokensFor(row, model),
    providerId: row.id,
    providerName: row.name,
    protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
  }
  cache.set(scope, { at: now(), value })
  return value
}

/** 仅供测试：重置进程级状态（默认 repo 缓存 / 表缺失告警）。 */
export function __resetLlmRegistryForTests(): void {
  for (const cache of allCaches) cache.clear()
  warnedTableMissing = false
  defaultRepo = null
}
