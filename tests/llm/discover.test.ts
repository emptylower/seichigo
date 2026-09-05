import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import { createDiscoverModelsHandler } from '@/lib/llm/handlers/discoverModels'
import { discoverModels, buildModelsUrl } from '@/lib/llm/discover'
import type { LlmAdminApiDeps } from '@/lib/llm/handlers/adminProviders'

/** 第七轮 A4：模型发现（sub2api / OpenAI 形 /v1/models 与 anthropic 头） */

const ADMIN = { user: { isAdmin: true } }

function makeDeps(fetchImpl?: unknown): LlmAdminApiDeps {
  return {
    getSession: async () => ADMIN,
    repo: createMemoryLlmProviderRepo(),
    ...(fetchImpl ? { fetchImpl: fetchImpl as typeof fetch } : {}),
  }
}

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/llm/providers/discover-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.LLM_PROVIDER_SECRET = 'discover-test-secret'
})

describe('discoverModels', () => {
  it('sub2api 形 /v1/models 响应：基地址归一出 models URL，解析 data[].id 列表并排序去重', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' },
            { id: 'gpt-5-mini', object: 'model', owned_by: 'openai' },
            { id: 'gpt-5-mini', object: 'model', owned_by: 'openai' }, // 重复项去重
            { id: 'claude-4-5', context_length: 200000 },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await discoverModels({
      protocol: 'openai',
      baseUrl: 'https://gw.sub2api.example.com/v1',
      apiKey: 'sk-gw-key-123456',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.endpointUrl).toBe('https://gw.sub2api.example.com/v1/chat/completions')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gw.sub2api.example.com/v1/models',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
    expect(result.models).toEqual([
      { name: 'claude-4-5', contextLength: 200000 },
      { name: 'deepseek-v4-flash', contextLength: null, ownedBy: 'deepseek' },
      { name: 'gpt-5-mini', contextLength: null, ownedBy: 'openai' },
    ])
    const headers = (fetchImpl.mock.calls[0]![1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBe('Bearer sk-gw-key-123456')
  })

  it('contextLength 兼容 context_window / max_context_length 字段；models[].name 形也能解析', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { name: 'm-a', context_window: 64000 },
            { name: 'm-b', max_context_length: 128000 },
            { name: 'm-c' },
          ],
        }),
        { status: 200 },
      ),
    )
    const result = await discoverModels({
      protocol: 'openai',
      baseUrl: 'https://x.example.com',
      apiKey: 'sk-k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.models).toEqual([
      { name: 'm-a', contextLength: 64000 },
      { name: 'm-b', contextLength: 128000 },
      { name: 'm-c', contextLength: null },
    ])
  })

  it('anthropic：用 x-api-key + anthropive-version 头，endpoint 归一到 /v1/messages、models URL 到 /v1/models', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'claude-4-5-sonnet' }] }), { status: 200 }),
    )
    const result = await discoverModels({
      protocol: 'anthropic',
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-ant-key-999888',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.endpointUrl).toBe('https://gw.example.com/v1/messages')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gw.example.com/v1/models',
      expect.anything(),
    )
    const headers = (fetchImpl.mock.calls[0]![1] as { headers: Record<string, string> }).headers
    expect(headers['x-api-key']).toBe('sk-ant-key-999888')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.Authorization).toBeUndefined()
  })

  it('401 → ok:false，message 不含明文 key（脱敏在 handler 层完成）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('unauthorized: key sk-gw-key-123456 invalid', { status: 401 }),
    )
    const handler = createDiscoverModelsHandler(makeDeps(fetchImpl))
    const res = await handler(
      jsonReq({ baseUrl: 'https://gw.sub2api.example.com/v1', protocol: 'openai', apiKey: 'sk-gw-key-123456' }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; message: string }
    expect(data.ok).toBe(false)
    expect(data.message).toContain('HTTP 401')
    expect(data.message).not.toContain('sk-gw-key-123456')
    expect(data.message).toContain('[redacted]')
  })

  it('L9：响应体超过 2 MB（无 Content-Length）流式中止并按失败处理', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }),
    )
    const result = await discoverModels({
      protocol: 'openai',
      baseUrl: 'https://x.example.com/v1',
      apiKey: 'sk-k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('2 MB')
  })

  it('L9：Content-Length 声明超限直接失败，不读响应体', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-length': '9999999' } }),
    )
    const result = await discoverModels({
      protocol: 'openai',
      baseUrl: 'https://x.example.com/v1',
      apiKey: 'sk-k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('2 MB')
  })

  it('内网地址 → ok:false（SSRF 守卫），HTTP 状态仍 200', async () => {
    const handler = createDiscoverModelsHandler(makeDeps())
    const res = await handler(
      jsonReq({ baseUrl: 'https://127.0.0.1:3000/v1', protocol: 'openai', apiKey: 'sk-k' }),
    )
    expect(res.status).toBe(200)
    const data = (await res.json()) as { ok: boolean; message: string }
    expect(data.ok).toBe(false)
    expect(data.message).toContain('内网')
  })
})

describe('discover-models handler', () => {
  it('非管理员 401；缺 baseUrl 400；缺 key 时 ok:false 提示', async () => {
    const unauth = createDiscoverModelsHandler({ ...makeDeps(), getSession: async () => null })
    expect((await unauth(jsonReq({ baseUrl: 'https://x.example.com' }))).status).toBe(401)

    const handler = createDiscoverModelsHandler(makeDeps())
    expect((await handler(jsonReq({ protocol: 'openai' }))).status).toBe(400)
    expect((await handler(jsonReq({ baseUrl: 'https://x.example.com', protocol: 'bogus' }))).status).toBe(400)

    const noKey = (await (
      await handler(jsonReq({ baseUrl: 'https://x.example.com', protocol: 'openai' }))
    ).json()) as { ok: boolean; message: string }
    expect(noKey.ok).toBe(false)
    expect(noKey.message).toContain('API key')
  })

  it('providerId 给出且 apiKey 缺省时用已存 key 拉取；供应商无 key 时 ok:false', async () => {
    const deps = makeDeps()
    const created = await deps.repo.create({
      name: '我的网关',
      protocol: 'openai',
      baseUrl: 'https://gw.example.com/v1',
      endpointUrl: 'https://gw.example.com/v1/chat/completions',
      apiKeyCiphertext: await import('@/lib/llm/secretBox').then((m) => m.encryptSecret('sk-stored-key-999999')),
      apiKeyHint: 'sk-…9999',
      models: [{ name: 'm', contextLength: 128000 }],
    })

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), { status: 200 }),
    )
    const handler = createDiscoverModelsHandler({ ...deps, fetchImpl: fetchImpl as unknown as typeof fetch })
    const res = await handler(
      jsonReq({ baseUrl: 'https://gw.example.com/v1', protocol: 'openai', providerId: created.id }),
    )
    const data = (await res.json()) as { ok: boolean; models: Array<{ name: string }>; endpointUrl: string }
    expect(data.ok).toBe(true)
    expect(data.models.map((m) => m.name)).toEqual(['m1', 'm2'])
    expect(data.endpointUrl).toBe('https://gw.example.com/v1/chat/completions')
    const headers = (fetchImpl.mock.calls[0]![1] as { headers: Record<string, string> }).headers
    expect(headers.Authorization).toBe('Bearer sk-stored-key-999999')

    // 无 key 供应商 + 不带 apiKey → ok:false
    const keyless = await deps.repo.create({
      name: '无 key',
      protocol: 'openai',
      endpointUrl: 'https://relay.example.com/v1/chat/completions',
      apiKeyCiphertext: null,
      apiKeyHint: null,
      models: [{ name: 'm', contextLength: 128000 }],
    })
    const fail = (await (
      await createDiscoverModelsHandler(deps)(jsonReq({ baseUrl: 'https://relay.example.com/v1', protocol: 'openai', providerId: keyless.id }))
    ).json()) as { ok: boolean; message: string }
    expect(fail.ok).toBe(false)
    expect(fail.message).toContain('API key')
  })
})

describe('buildModelsUrl', () => {
  it('把请求 endpoint 的最后一段换成 /models', () => {
    expect(buildModelsUrl('https://x.example.com/v1/chat/completions')).toBe('https://x.example.com/v1/models')
    expect(buildModelsUrl('https://x.example.com/v1/messages')).toBe('https://x.example.com/v1/models')
    expect(buildModelsUrl('https://x.example.com/v1/chat/completions?foo=bar')).toBe(
      'https://x.example.com/v1/models?foo=bar',
    )
    // M4：Gemini 归一后的 endpoint → v1beta/openai/models
    expect(buildModelsUrl('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models',
    )
  })
})
