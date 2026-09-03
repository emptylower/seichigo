import type {
  LlmProviderCreateInput,
  LlmProviderPatch,
  LlmProviderRepo,
  LlmProviderRow,
} from './repo'
import { asModelConfigs } from './repo'

/**
 * 供应商仓储的内存实现：admin handlers / registry 的测试替身。
 * cuid 由递增计数器生成；updatedAt 语义与 Prisma @updatedAt 对齐（写即刷新）。
 */
export function createMemoryLlmProviderRepo(now: () => Date = () => new Date()): LlmProviderRepo {
  const rows = new Map<string, LlmProviderRow>()
  let seq = 0

  const nextId = () => `llm-${++seq}`

  function insert(input: LlmProviderCreateInput): LlmProviderRow {
    const at = now()
    const row: LlmProviderRow = {
      id: nextId(),
      name: input.name,
      protocol: input.protocol,
      endpointUrl: input.endpointUrl,
      apiKeyCiphertext: input.apiKeyCiphertext,
      apiKeyHint: input.apiKeyHint,
      models: asModelConfigs(input.models),
      takeoverAgent: input.takeoverAgent ?? false,
      takeoverTranslation: input.takeoverTranslation ?? false,
      agentModel: input.agentModel ?? null,
      translationModel: input.translationModel ?? null,
      source: input.source ?? 'custom',
      envKey: input.envKey ?? null,
      enabled: input.enabled ?? true,
      lastTest: null,
      createdAt: at,
      updatedAt: at,
    }
    rows.set(row.id, row)
    return { ...row }
  }

  return {
    async list() {
      return [...rows.values()]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((row) => ({ ...row }))
    },

    async get(id: string) {
      const row = rows.get(id)
      return row ? { ...row } : null
    },

    async create(input) {
      return insert(input)
    },

    async update(id: string, patch: LlmProviderPatch) {
      const row = rows.get(id)
      if (!row) return null
      const next: LlmProviderRow = {
        ...row,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.protocol !== undefined ? { protocol: patch.protocol } : {}),
        ...(patch.endpointUrl !== undefined ? { endpointUrl: patch.endpointUrl } : {}),
        ...(patch.apiKeyCiphertext !== undefined ? { apiKeyCiphertext: patch.apiKeyCiphertext } : {}),
        ...(patch.apiKeyHint !== undefined ? { apiKeyHint: patch.apiKeyHint } : {}),
        ...(patch.models !== undefined ? { models: asModelConfigs(patch.models) } : {}),
        ...(patch.takeoverAgent !== undefined ? { takeoverAgent: patch.takeoverAgent } : {}),
        ...(patch.takeoverTranslation !== undefined
          ? { takeoverTranslation: patch.takeoverTranslation }
          : {}),
        ...(patch.agentModel !== undefined ? { agentModel: patch.agentModel } : {}),
        ...(patch.translationModel !== undefined ? { translationModel: patch.translationModel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.lastTest !== undefined ? { lastTest: patch.lastTest } : {}),
        updatedAt: now(),
      }
      rows.set(id, next)
      return { ...next }
    },

    async delete(id: string) {
      return rows.delete(id)
    },

    async clearTakeover(scope, exceptId) {
      let touched = 0
      for (const row of rows.values()) {
        const flag = scope === 'agent' ? row.takeoverAgent : row.takeoverTranslation
        if (!flag || row.id === exceptId) continue
        rows.set(row.id, {
          ...row,
          ...(scope === 'agent' ? { takeoverAgent: false } : { takeoverTranslation: false }),
          updatedAt: now(),
        })
        touched += 1
      }
      return touched
    },

    async setLastTest(id, result) {
      const row = rows.get(id)
      if (!row) return null
      const next = { ...row, lastTest: result, updatedAt: now() }
      rows.set(id, next)
      return { ...next }
    },
  }
}
