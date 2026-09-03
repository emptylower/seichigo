import { describe, expect, it, vi } from 'vitest'
import { cleanupObsoleteMirrorState, type MirrorCleanupPrisma } from '@/lib/anitabi/mirror/cleanup'

type RecordedCall = { sql: string; values: unknown[] }

function buildCleanupPrisma(opts: { deleteCounts?: number[]; resetCounts?: number[] }) {
  const calls: RecordedCall[] = []
  const deleteCounts = [...(opts.deleteCounts ?? [])]
  const resetCounts = [...(opts.resetCounts ?? [])]

  const $executeRaw = vi.fn<MirrorCleanupPrisma['$executeRaw']>().mockImplementation(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('$?')
      calls.push({ sql, values })

      if (sql.includes('DELETE')) {
        return deleteCounts.shift() ?? 0
      }
      return resetCounts.shift() ?? 0
    },
  )

  const prisma: MirrorCleanupPrisma = { $executeRaw }
  return { prisma, calls }
}

describe('cleanupObsoleteMirrorState', () => {
  it('deletes every h320 row and resets upstream-403 failed rows in batches', async () => {
    const { prisma, calls } = buildCleanupPrisma({
      deleteCounts: [5_000, 5_000, 1_668],
      resetCounts: [2_209],
    })

    const result = await cleanupObsoleteMirrorState(prisma)

    expect(result).toEqual({ deletedH320: 11_668, resetFailed: 2_209 })

    const deleteCalls = calls.filter((call) => call.sql.includes('DELETE'))
    const resetCalls = calls.filter((call) => call.sql.includes('UPDATE'))

    expect(deleteCalls).toHaveLength(3)
    expect(resetCalls).toHaveLength(1)

    for (const call of deleteCalls) {
      expect(call.sql).toContain('"MapImageMirrorState"')
      expect(call.sql).toContain(`"variant" = 'h320'`)
      expect(call.values).toEqual([5_000])
    }

    for (const call of resetCalls) {
      expect(call.sql).toContain('"status" = \'failed\'')
      expect(call.sql).toContain("LIKE '%upstream 403%'")
      expect(call.sql).toContain(`"status" = 'pending'`)
      expect(call.values).toEqual([5_000])
    }
  })

  it('stops batching as soon as a batch comes back short', async () => {
    const { prisma, calls } = buildCleanupPrisma({
      deleteCounts: [4_999],
      resetCounts: [0],
    })

    const result = await cleanupObsoleteMirrorState(prisma)

    expect(result).toEqual({ deletedH320: 4_999, resetFailed: 0 })
    expect(calls).toHaveLength(2)
  })

  it('is a no-op on a clean database', async () => {
    const { prisma, calls } = buildCleanupPrisma({ deleteCounts: [0], resetCounts: [0] })

    const result = await cleanupObsoleteMirrorState(prisma)

    expect(result).toEqual({ deletedH320: 0, resetFailed: 0 })
    expect(calls).toHaveLength(2)
  })
})
