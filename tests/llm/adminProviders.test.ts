import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import type { LlmProviderRepo } from '@/lib/llm/repo'
import { createHandlers, type LlmAdminApiDeps } from '@/lib/llm/handlers/adminProviders'
import { routeError } from '@/lib/llm/handlers/common'

const ADMIN = { user: { isAdmin: true } }
const NON_ADMIN = { user: { isAdmin: false } }

function makeDeps(overrides: Partial<LlmAdminApiDeps> = {}): LlmAdminApiDeps {
  return {
    getSession: async () => ADMIN,
    repo: createMemoryLlmProviderRepo(() => new Date('2026-09-03T00:00:00.000Z')),
    now: () => new Date('2026-09-03T00:00:00.000Z'),
    ...overrides,
  }
}

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/llm/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  name: '我的中转',
  protocol: 'openai',
  endpointUrl: 'https://relay.example.com/v1/chat/completions',
  apiKey: 'sk-abcdef123456',
  models: [{ name: 'gpt-mini', contextLength: 128000 }],
}

beforeEach(() => {
  process.env.LLM_PROVIDER_SECRET = 'admin-test-secret'
  delete process.env.PLAN_AGENT_API_KEY
  delete process.env.PLAN_AGENT_MODEL
  delete process.env.PLAN_AGENT_BASE_URL
  delete process.env.GEMINI_API_KEY
})

describe('admin llm providers api', () => {
  it('rejects non-admin sessions with 401 on every method', async () => {
    const deps = makeDeps({ getSession: async () => null })
    const handlers = createHandlers(deps)

    expect((await handlers.GET()).status).toBe(401)
    expect((await handlers.POST(jsonReq(VALID_BODY))).status).toBe(401)
    expect((await handlers.PUT(jsonReq({}), 'x')).status).toBe(401)
    expect((await handlers.DELETE('x')).status).toBe(401)
    expect((await handlers.TEST(jsonReq({ model: 'm' }), 'x')).status).toBe(401)

    const deps2 = makeDeps({ getSession: async () => NON_ADMIN })
    expect((await createHandlers(deps2).GET()).status).toBe(401)
  })

  it('rejects http URLs, private hosts, empty models and out-of-range contextLength with 400', async () => {
    const handlers = createHandlers(makeDeps())

    const cases: Array<Record<string, unknown>> = [
      { ...VALID_BODY, endpointUrl: 'http://relay.example.com/v1/chat/completions' },
      { ...VALID_BODY, endpointUrl: 'https://127.0.0.1/v1/chat/completions' },
      { ...VALID_BODY, endpointUrl: 'https://10.1.2.3/v1/chat/completions' },
      { ...VALID_BODY, endpointUrl: 'https://192.168.0.10/v1/chat/completions' },
      { ...VALID_BODY, endpointUrl: 'https://localhost:3000/v1/chat/completions' },
      { ...VALID_BODY, models: [] },
      { ...VALID_BODY, models: [{ name: 'm', contextLength: 999 }] },
      { ...VALID_BODY, models: [{ name: 'm', contextLength: 20_000_000 }] },
      { ...VALID_BODY, models: [{ name: 'm', contextLength: 128000.5 }] },
      { ...VALID_BODY, models: [{ name: 'm', contextLength: 128000 }, { name: 'm', contextLength: 64000 }] },
      { ...VALID_BODY, apiKey: '' },
      { ...VALID_BODY, name: '' },
      { ...VALID_BODY, protocol: 'google' },
    ]

    for (const body of cases) {
      const res = await handlers.POST(jsonReq(body))
      expect(res.status).toBe(400)
      const data = (await res.json()) as { error: string }
      expect(typeof data.error).toBe('string')
      expect(data.error.length).toBeGreaterThan(0)
    }
  })

  it('creates a provider, returns a hint but never the key or ciphertext', async () => {
    const handlers = createHandlers(makeDeps())
    const res = await handlers.POST(jsonReq(VALID_BODY))
    expect(res.status).toBe(200)

    const data = (await res.json()) as {
      ok: boolean
      provider: Record<string, unknown> & { apiKeyHint: string | null; models: unknown[] }
    }
    expect(data.ok).toBe(true)
    expect(data.provider.apiKeyHint).toBe('sk-…3456')
    expect(data.provider.hasApiKey).toBe(true)
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('sk-abcdef123456')
    expect(serialized).not.toContain('apiKeyCiphertext')
    expect(data.provider.takeover).toEqual({ agent: false, translation: false })

    // 行里确实有密文（仅仓储层可见）
    const rows = await makeDeps().repo.list()
    expect(rows).toHaveLength(0) // 新 deps 是新 repo；上面那个 repo 不在此处
  })

  it('第七轮 A4：POST 接受 baseUrl（可为基地址）——归一后入库 endpointUrl，视图同时输出 baseUrl/endpointUrl', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const res = await handlers.POST(
      jsonReq({
        ...VALID_BODY,
        baseUrl: 'https://gw.sub2api.example.com/v1/',
        endpointUrl: undefined,
      }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      provider: { baseUrl: string; endpointUrl: string }
    }
    expect(data.provider.baseUrl).toBe('https://gw.sub2api.example.com/v1/')
    expect(data.provider.endpointUrl).toBe('https://gw.sub2api.example.com/v1/chat/completions')

    const row = (await deps.repo.list())[0]!
    expect(row.baseUrl).toBe('https://gw.sub2api.example.com/v1/')
    expect(row.endpointUrl).toBe('https://gw.sub2api.example.com/v1/chat/completions')

    // anthropic 基地址同理
    const res2 = await handlers.POST(
      jsonReq({
        name: 'Claude 网关',
        protocol: 'anthropic',
        baseUrl: 'https://gw.example.com',
        apiKey: 'sk-ant-abcdef123456',
        models: [{ name: 'claude-4-5', contextLength: 200000 }],
      }),
    )
    const data2 = (await res2.json()) as { provider: { baseUrl: string; endpointUrl: string } }
    expect(data2.provider.endpointUrl).toBe('https://gw.example.com/v1/messages')
  })

  it('第七轮 A4：旧客户端只传 endpointUrl 仍可用（baseUrl 回落为完整 URL）；两者都不传 POST 报 400', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const res = await handlers.POST(jsonReq(VALID_BODY))
    const data = (await res.json()) as { provider: { id: string; baseUrl: string; endpointUrl: string } }
    expect(data.provider.baseUrl).toBe(VALID_BODY.endpointUrl)
    expect(data.provider.endpointUrl).toBe(VALID_BODY.endpointUrl)

    const bad = await handlers.POST(jsonReq({ ...VALID_BODY, endpointUrl: undefined }))
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toContain('baseUrl')

    // PUT 传内网 baseUrl → 归一结果被 SSRF 守卫拦下
    const put = await handlers.PUT(jsonReq({ baseUrl: 'https://192.168.0.10/v1' }), data.provider.id)
    expect(put.status).toBe(400)
  })

  it('L6：baseUrl 携带 userinfo 时入库前剥掉（origin+pathname+search），endpointUrl 同样无凭据', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const res = await handlers.POST(
      jsonReq({
        ...VALID_BODY,
        baseUrl: 'https://relay:secret%40pass@gw.example.com:8443/v1?q=1',
        endpointUrl: undefined,
      }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { provider: { baseUrl: string; endpointUrl: string } }
    expect(data.provider.baseUrl).toBe('https://gw.example.com:8443/v1?q=1')
    expect(data.provider.endpointUrl).toBe('https://gw.example.com:8443/v1/chat/completions?q=1')

    const row = (await deps.repo.list())[0]!
    expect(row.baseUrl).not.toContain('relay:')
    expect(row.baseUrl).not.toContain('secret')

    // 旧客户端只传 endpointUrl 的分支同样剥凭据（baseUrl 镜像值不带 userinfo）
    const second = await handlers.POST(
      jsonReq({
        name: '再来一家',
        protocol: 'openai',
        endpointUrl: 'https://user:pass@relay2.example.com/v1/chat/completions',
        apiKey: 'sk-another-key-9999',
        models: [{ name: 'm2', contextLength: 128000 }],
      }),
    )
    const data2 = (await second.json()) as { provider: { baseUrl: string; endpointUrl: string } }
    expect(data2.provider.baseUrl).toBe('https://relay2.example.com/v1/chat/completions')
  })

  it('PUT takeover.agent=true clears the flag on other providers (mutex) and validates agentModel', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    await handlers.POST(jsonReq(VALID_BODY))
    const second = await handlers.POST(
      jsonReq({ ...VALID_BODY, name: '第二家', apiKey: 'sk-second-key-9999' }),
    )
    const secondId = ((await second.json()) as { provider: { id: string } }).provider.id

    // agentModel 缺失 → 400
    let res = await handlers.PUT(jsonReq({ takeover: { agent: true } }), secondId)
    expect(res.status).toBe(400)

    // agentModel 不在 models 里 → 400
    res = await handlers.PUT(jsonReq({ takeover: { agent: true }, agentModel: 'nope' }), secondId)
    expect(res.status).toBe(400)

    // 正常接管
    res = await handlers.PUT(
      jsonReq({ takeover: { agent: true }, agentModel: 'gpt-mini' }),
      secondId,
    )
    expect(res.status).toBe(200)
    let rows = await deps.repo.list()
    expect(rows.find((r) => r.id === secondId)?.takeoverAgent).toBe(true)
    expect(rows.find((r) => r.id !== secondId)?.takeoverAgent).toBe(false)

    // 第一家再接管 → 第二家被清
    const firstId = rows.find((r) => r.id !== secondId)!.id
    res = await handlers.PUT(
      jsonReq({ takeover: { agent: true }, agentModel: 'gpt-mini' }),
      firstId,
    )
    expect(res.status).toBe(200)
    rows = await deps.repo.list()
    expect(rows.find((r) => r.id === firstId)?.takeoverAgent).toBe(true)
    expect(rows.find((r) => r.id === secondId)?.takeoverAgent).toBe(false)
  })

  it('DELETE removes the provider; effective falls back to null (env vars)', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const created = await handlers.POST(jsonReq(VALID_BODY))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id
    await handlers.PUT(jsonReq({ takeover: { translation: true }, translationModel: 'gpt-mini' }), id)

    const before = await handlers.GET()
    const data = (await before.json()) as { effective: { translation: { providerId: string } | null } }
    expect(data.effective.translation?.providerId).toBe(id)

    const deleted = await handlers.DELETE(id)
    expect(deleted.status).toBe(200)
    expect((await deleted.json()).ok).toBe(true)

    const after = await handlers.GET()
    const afterData = (await after.json()) as { effective: { translation: { providerId: string } | null } }
    expect(afterData.effective.translation).toBeNull()
    const again = await handlers.DELETE(id)
    expect(again.status).toBe(404)
  })

  it('TEST reports success with latency and sample, and persists lastTest', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const created = await handlers.POST(jsonReq(VALID_BODY))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }),
    )
    const res = await createHandlers({ ...deps, fetchImpl: fetchImpl as unknown as typeof fetch })
      .TEST(jsonReq({ model: 'gpt-mini' }), id)

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      ok: boolean
      result: { ok: boolean; latencyMs: number; message: string | null; sample: string }
    }
    expect(data.ok).toBe(true)
    expect(data.result.ok).toBe(true)
    expect(data.result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(data.result.sample).toBe('OK')

    // 第七轮 A5：请求 max_tokens 8 → 64（推理模型 reasoning 也要耗 completion 预算）
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)) as { max_tokens: number }
    expect(body.max_tokens).toBe(64)

    const row = await deps.repo.get(id)
    expect(row?.lastTest).toMatchObject({ model: 'gpt-mini', ok: true })
  })

  it('TEST：推理模型 content 为空时 sample 显示（仅推理无正文）', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const created = await handlers.POST(jsonReq(VALID_BODY))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
    )
    const res = await createHandlers({ ...deps, fetchImpl: fetchImpl as unknown as typeof fetch })
      .TEST(jsonReq({ model: 'gpt-mini' }), id)

    const data = (await res.json()) as { result: { ok: boolean; sample: string } }
    expect(data.result.ok).toBe(true)
    expect(data.result.sample).toBe('(仅推理无正文)')
  })

  it('TEST reports failure inside result.message (HTTP 200) and redacts key-like strings', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const created = await handlers.POST(jsonReq(VALID_BODY))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('unauthorized: key sk-leaked-123456 invalid', { status: 401 }),
    )
    const res = await createHandlers({ ...deps, fetchImpl: fetchImpl as unknown as typeof fetch })
      .TEST(jsonReq({ model: 'gpt-mini' }), id)

    expect(res.status).toBe(200)
    const data = (await res.json()) as {
      result: { ok: boolean; message: string | null }
    }
    expect(data.result.ok).toBe(false)
    expect(data.result.message).toContain('HTTP 401')
    expect(data.result.message).not.toContain('sk-leaked-123456')
    expect(data.result.message).toContain('[redacted]')

    const row = await deps.repo.get(id)
    expect(row?.lastTest).toMatchObject({ ok: false })
  })

  it('TEST redacts the plaintext key echoed back by the upstream body even without key-like prefixes', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    // AIza 开头的 key 不匹配 sk-/Bearer 前缀正则：只能靠明文整串替换兜住
    const created = await handlers.POST(jsonReq({ ...VALID_BODY, apiKey: 'AIza-gemini-key-9999' }))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('API key AIza-gemini-key-9999 is invalid', { status: 401 }),
    )
    const res = await createHandlers({ ...deps, fetchImpl: fetchImpl as unknown as typeof fetch })
      .TEST(jsonReq({ model: 'gpt-mini' }), id)

    const data = (await res.json()) as { result: { ok: boolean; message: string | null } }
    expect(data.result.ok).toBe(false)
    expect(data.result.message).toContain('HTTP 401')
    expect(data.result.message).not.toContain('AIza-gemini-key-9999')
    expect(data.result.message).toContain('[redacted]')

    // 落库的 lastTest 同样不含明文
    const row = await deps.repo.get(id)
    expect(JSON.stringify(row?.lastTest)).not.toContain('AIza-gemini-key-9999')
  })

  it('effective ignores a takeover provider without a stored key (matches runtime)', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const created = await handlers.POST(jsonReq(VALID_BODY))
    const id = ((await created.json()) as { provider: { id: string } }).provider.id
    // 加密失败/轮换后的形态：接管位为真但行内没有密文
    await deps.repo.update(id, { apiKeyCiphertext: null, apiKeyHint: null })
    await handlers.PUT(jsonReq({ takeover: { agent: true }, agentModel: 'gpt-mini' }), id)

    const data = (await (await handlers.GET()).json()) as {
      effective: { agent: { providerId: string } | null }
    }
    expect(data.effective.agent).toBeNull()
  })

  it('PUT on a vanished row returns 404 and leaves other providers takeover intact', async () => {
    const deps = makeDeps()
    const handlers = createHandlers(deps)
    const first = await handlers.POST(jsonReq(VALID_BODY))
    const firstId = ((await first.json()) as { provider: { id: string } }).provider.id
    await handlers.PUT(jsonReq({ takeover: { agent: true }, agentModel: 'gpt-mini' }), firstId)

    const second = await handlers.POST(
      jsonReq({ ...VALID_BODY, name: '第二家', apiKey: 'sk-second-key-9999' }),
    )
    const secondId = ((await second.json()) as { provider: { id: string } }).provider.id

    // get 之后、update 之前行被并发删除：update 落空返回 null
    const brokenRepo: LlmProviderRepo = {
      ...deps.repo,
      update: async () => null,
    }
    const res = await createHandlers({ ...deps, repo: brokenRepo }).PUT(
      jsonReq({ takeover: { agent: true }, agentModel: 'gpt-mini' }),
      secondId,
    )
    expect(res.status).toBe(404)

    const rows = await deps.repo.list()
    expect(rows.find((r) => r.id === firstId)?.takeoverAgent).toBe(true)
    expect(rows.find((r) => r.id === secondId)?.takeoverAgent).toBe(false)
  })

  it('POST rejects cleanly when no secret env is configured (route maps to 500, no secret text leaked)', async () => {
    delete process.env.LLM_PROVIDER_SECRET
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET

    const handlers = createHandlers(makeDeps())
    const err: unknown = await handlers.POST(jsonReq(VALID_BODY)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('LLM_PROVIDER_SECRET 未配置')
    // 错误文案不回显请求里的 key
    expect((err as Error).message).not.toContain('sk-abcdef123456')

    const mapped = routeError(err)
    expect(mapped.status).toBe(500)
    const body = JSON.stringify(await mapped.json())
    expect(body).not.toContain('sk-abcdef123456')
    expect(body).not.toContain('LLM_PROVIDER_SECRET')
  })

  it('seeds env providers on the first GET and does not duplicate on the second', async () => {
    process.env.PLAN_AGENT_API_KEY = 'sk-plan-agent-key-1'
    process.env.PLAN_AGENT_MODEL = 'deepseek-v4-flash'
    process.env.GEMINI_API_KEY = 'AIza-gemini-key-9999'

    const deps = makeDeps()
    const handlers = createHandlers(deps)

    const first = (await (await handlers.GET()).json()) as {
      providers: Array<{ name: string; source: string; envKey?: string }>
      effective: { agent: { model: string } | null; translation: { model: string } | null }
    }
    expect(first.providers).toHaveLength(2)
    expect(first.providers.map((p) => p.name).sort()).toEqual(['DeepSeek（环境变量）', 'Gemini（环境变量）'])
    expect(first.providers.every((p) => p.source === 'env')).toBe(true)
    expect(first.effective.agent?.model).toBe('deepseek-v4-flash')
    expect(first.effective.translation?.model).toBe('gemini-2.5-flash')

    const second = (await (await handlers.GET()).json()) as {
      providers: Array<{ name: string }>
    }
    expect(second.providers).toHaveLength(2)

    // 表非空时不再内化：清空 env 后 GET 不增不减
    delete process.env.PLAN_AGENT_API_KEY
    const third = (await (await handlers.GET()).json()) as { providers: unknown[] }
    expect(third.providers).toHaveLength(2)
  })
})
