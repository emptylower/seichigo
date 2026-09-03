import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '@/lib/llm/secretBox'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import {
  __resetLlmRegistryForTests,
  invalidateLlmRegistry,
  resolveLlmForScope,
} from '@/lib/llm/registry'

beforeEach(() => {
  process.env.LLM_PROVIDER_SECRET = 'registry-test-secret'
  __resetLlmRegistryForTests()
})

afterEach(() => {
  __resetLlmRegistryForTests()
  vi.restoreAllMocks()
})

async function boxedKey(key = 'sk-registry-test-key') {
  return encryptSecret(key)
}

async function seedTakeover(overrides: Record<string, unknown> = {}) {
  const repo = createMemoryLlmProviderRepo()
  await repo.create({
    name: '自定义中转',
    protocol: 'openai',
    endpointUrl: 'https://relay.example.com/v1/chat/completions',
    apiKeyCiphertext: await boxedKey(),
    apiKeyHint: 'sk-…key',
    models: [
      { name: 'model-a', contextLength: 128000, maxOutputTokens: 8192 },
      { name: 'model-b', contextLength: 64000 },
    ],
    takeoverAgent: true,
    agentModel: 'model-a',
    ...overrides,
  })
  return repo
}

describe('resolveLlmForScope', () => {
  it('resolves the takeover provider with client, model and maxOutputTokens', async () => {
    const repo = await seedTakeover()
    const resolved = await resolveLlmForScope('agent', { repo })

    expect(resolved).not.toBeNull()
    expect(resolved!.providerName).toBe('自定义中转')
    expect(resolved!.providerId).toBeTruthy()
    expect(resolved!.model).toBe('model-a')
    expect(resolved!.maxOutputTokens).toBe(8192)
    // 解密出的 client 持有明文 key：请求头打到注入的 fetch 上验证
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    )
    const text = await (
      await import('@/lib/llm/client')
    )
      .createLlmClient({
        protocol: 'openai',
        endpointUrl: 'https://relay.example.com/v1/chat/completions',
        apiKey: 'sk-registry-test-key',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      .completeText({ model: 'model-a', prompt: 'ping', maxTokens: 8 })
    expect(text).toBe('ok')
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-registry-test-key')
  })

  it('derives maxOutputTokens from contextLength/4 capped at 32768 when unset', async () => {
    const repo = await seedTakeover({ agentModel: 'model-b' })
    expect((await resolveLlmForScope('agent', { repo }))!.maxOutputTokens).toBe(16000)
  })

  it('returns null when no provider takes over the scope', async () => {
    const repo = createMemoryLlmProviderRepo()
    await repo.create({
      name: 'p',
      protocol: 'openai',
      endpointUrl: 'https://relay.example.com/v1/chat/completions',
      apiKeyCiphertext: await boxedKey(),
      apiKeyHint: null,
      models: [{ name: 'm', contextLength: 1000 }],
    })
    expect(await resolveLlmForScope('agent', { repo })).toBeNull()
    expect(await resolveLlmForScope('translation', { repo })).toBeNull()
  })

  it('returns null when the takeover provider is disabled', async () => {
    const repo = await seedTakeover({ enabled: false })
    expect(await resolveLlmForScope('agent', { repo })).toBeNull()
  })

  it('returns null when the provider has no stored key', async () => {
    const repo = await seedTakeover({ apiKeyCiphertext: null, apiKeyHint: null })
    expect(await resolveLlmForScope('agent', { repo })).toBeNull()
  })

  it('caches resolutions per scope for 30s; invalidateLlmRegistry clears immediately', async () => {
    let tick = 0
    const now = () => tick
    const repo = await seedTakeover()

    const first = await resolveLlmForScope('agent', { repo, now })
    expect(first).not.toBeNull()

    // 删除供应商后仍在 TTL 内 → 命中缓存
    await repo.delete((await repo.list())[0].id)
    tick += 1_000
    expect(await resolveLlmForScope('agent', { repo, now })).toBe(first)

    // 超过 TTL → 重新查表 → 未命中
    tick += 31_000
    expect(await resolveLlmForScope('agent', { repo, now })).toBeNull()

    // invalidateLlmRegistry 后立即重新查表（不推进虚拟时钟）
    const repo2 = await seedTakeover()
    invalidateLlmRegistry()
    const again = await resolveLlmForScope('agent', { repo: repo2, now })
    expect(again).not.toBeNull()
    await repo2.delete((await repo2.list())[0].id)
    invalidateLlmRegistry()
    expect(await resolveLlmForScope('agent', { repo: repo2, now })).toBeNull()
  })

  it('isolates the cache per repo instance (an empty repo miss does not evict another repo hit)', async () => {
    const repoA = await seedTakeover()
    const repoB = createMemoryLlmProviderRepo() // 空表：永远未接管

    expect(await resolveLlmForScope('agent', { repo: repoA })).not.toBeNull()
    expect(await resolveLlmForScope('agent', { repo: repoB })).toBeNull()
    // TTL 内再读 A：B 的 null 结果没有覆盖 A 的缓存
    expect(await resolveLlmForScope('agent', { repo: repoA })).not.toBeNull()

    // invalidate 后两个 repo 都重新查表，行为一致
    invalidateLlmRegistry()
    expect(await resolveLlmForScope('agent', { repo: repoA })).not.toBeNull()
    expect(await resolveLlmForScope('agent', { repo: repoB })).toBeNull()
  })

  it('returns null (warning once) when the table is missing (P2021)', async () => {
    const repo = {
      list: async () => {
        throw Object.assign(new Error('table does not exist'), { code: 'P2021' })
      },
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveLlmForScope('translation', { repo: repo as never })).toBeNull()
    expect(await resolveLlmForScope('translation', { repo: repo as never })).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null when decryption fails (secret rotated)', async () => {
    const repo = await seedTakeover({ apiKeyCiphertext: 'v1.AAAA.AAAA.AAAA' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveLlmForScope('agent', { repo })).toBeNull()
  })
})
