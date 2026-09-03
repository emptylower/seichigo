import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import type { LlmProviderRepo } from '@/lib/llm/repo'
import { seedProvidersFromEnv } from '@/lib/llm/seed'

beforeEach(() => {
  process.env.LLM_PROVIDER_SECRET = 'seed-test-secret'
  process.env.PLAN_AGENT_API_KEY = 'sk-plan-agent-key-1'
  process.env.PLAN_AGENT_MODEL = 'deepseek-v4-flash'
  process.env.GEMINI_API_KEY = 'AIza-gemini-key-9999'
})

describe('seedProvidersFromEnv (concurrency safety)', () => {
  it('seeds both env providers into an empty table', async () => {
    const repo = createMemoryLlmProviderRepo()
    await seedProvidersFromEnv(repo)
    const rows = await repo.list()
    expect(rows.map((r) => r.envKey).sort()).toEqual(['gemini', 'plan_agent'])
  })

  it('skips the whole seeding when the table already has rows', async () => {
    const repo = createMemoryLlmProviderRepo()
    await repo.create({
      name: '已有供应商',
      protocol: 'openai',
      endpointUrl: 'https://relay.example.com/v1/chat/completions',
      apiKeyCiphertext: 'v2.AAAA.AAAA.AAAA',
      apiKeyHint: null,
      models: [{ name: 'm', contextLength: 1000 }],
    })
    await seedProvidersFromEnv(repo)
    expect((await repo.list()).map((r) => r.name)).toEqual(['已有供应商'])
  })

  it('swallows Prisma P2002 (unique envKey) from a concurrent seeding race instead of throwing', async () => {
    const base = createMemoryLlmProviderRepo()
    const originalCreate = base.create.bind(base)
    let calls = 0
    const repo: LlmProviderRepo = {
      ...base,
      create: async (input) => {
        calls += 1
        if (calls === 2) {
          // 第二条（gemini）输掉了并发竞争：唯一约束冲突
          throw Object.assign(new Error('Unique constraint failed on the fields: (`envKey`)'), {
            code: 'P2002',
          })
        }
        return originalCreate(input)
      },
    }

    await expect(seedProvidersFromEnv(repo)).resolves.toBeUndefined()
    // 第一条已写入，第二条被静默跳过
    const rows = await repo.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].envKey).toBe('plan_agent')
  })

  it('still propagates non-P2002 create failures', async () => {
    const base = createMemoryLlmProviderRepo()
    const repo: LlmProviderRepo = {
      ...base,
      create: async () => {
        throw Object.assign(new Error('db is down'), { code: 'P1001' })
      },
    }
    await expect(seedProvidersFromEnv(repo)).rejects.toThrow('db is down')
  })
})
