import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type {
  LlmProviderCreateInput,
  LlmProviderPatch,
  LlmProviderRepo,
  LlmProviderRow,
} from './repo'

type DbRow = {
  id: string
  name: string
  protocol: string
  endpointUrl: string
  apiKeyCiphertext: string | null
  apiKeyHint: string | null
  models: Prisma.JsonValue
  takeoverAgent: boolean
  takeoverTranslation: boolean
  agentModel: string | null
  translationModel: string | null
  source: string
  envKey: string | null
  enabled: boolean
  lastTest: Prisma.JsonValue
  createdAt: Date
  updatedAt: Date
}

function toRow(row: DbRow): LlmProviderRow {
  return { ...row, models: (row.models ?? []) as LlmProviderRow['models'], lastTest: row.lastTest ?? null }
}

/** 供应商仓储的 Prisma 实现（生产 / OpenNext 路径）。 */
export function createPrismaLlmProviderRepo(db: typeof prisma = prisma): LlmProviderRepo {
  return {
    async list() {
      const rows = await db.llmProvider.findMany({ orderBy: { createdAt: 'asc' } })
      return rows.map(toRow)
    },

    async get(id) {
      const row = await db.llmProvider.findUnique({ where: { id } })
      return row ? toRow(row) : null
    },

    async create(input: LlmProviderCreateInput) {
      return toRow(
        await db.llmProvider.create({
          data: {
            name: input.name,
            protocol: input.protocol,
            endpointUrl: input.endpointUrl,
            apiKeyCiphertext: input.apiKeyCiphertext,
            apiKeyHint: input.apiKeyHint,
            models: input.models as unknown as Prisma.InputJsonValue,
            takeoverAgent: input.takeoverAgent ?? false,
            takeoverTranslation: input.takeoverTranslation ?? false,
            agentModel: input.agentModel ?? null,
            translationModel: input.translationModel ?? null,
            source: input.source ?? 'custom',
            envKey: input.envKey ?? null,
            enabled: input.enabled ?? true,
          },
        }),
      )
    },

    async update(id: string, patch: LlmProviderPatch) {
      const data: Prisma.LlmProviderUpdateInput = {}
      if (patch.name !== undefined) data.name = patch.name
      if (patch.protocol !== undefined) data.protocol = patch.protocol
      if (patch.endpointUrl !== undefined) data.endpointUrl = patch.endpointUrl
      if (patch.apiKeyCiphertext !== undefined) data.apiKeyCiphertext = patch.apiKeyCiphertext
      if (patch.apiKeyHint !== undefined) data.apiKeyHint = patch.apiKeyHint
      if (patch.models !== undefined) data.models = patch.models as unknown as Prisma.InputJsonValue
      if (patch.takeoverAgent !== undefined) data.takeoverAgent = patch.takeoverAgent
      if (patch.takeoverTranslation !== undefined) data.takeoverTranslation = patch.takeoverTranslation
      if (patch.agentModel !== undefined) data.agentModel = patch.agentModel
      if (patch.translationModel !== undefined) data.translationModel = patch.translationModel
      if (patch.enabled !== undefined) data.enabled = patch.enabled
      if (patch.lastTest !== undefined) data.lastTest = patch.lastTest as unknown as Prisma.InputJsonValue
      try {
        const row = await db.llmProvider.update({ where: { id }, data })
        return toRow(row)
      } catch (err) {
        // 记录不存在时 Prisma 抛 P2025；与内存实现的 null 语义对齐
        if ((err as { code?: string } | null)?.code === 'P2025') return null
        throw err
      }
    },

    async delete(id) {
      try {
        await db.llmProvider.delete({ where: { id } })
        return true
      } catch (err) {
        if ((err as { code?: string } | null)?.code === 'P2025') return false
        throw err
      }
    },

    async clearTakeover(scope, exceptId) {
      const result = await db.llmProvider.updateMany({
        where: {
          id: { not: exceptId },
          ...(scope === 'agent' ? { takeoverAgent: true } : { takeoverTranslation: true }),
        },
        data: scope === 'agent' ? { takeoverAgent: false } : { takeoverTranslation: false },
      })
      return result.count
    },

    async setLastTest(id, result) {
      return this.update(id, { lastTest: result })
    },
  }
}
