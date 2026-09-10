import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import { createHandlers, type LlmAdminApiDeps } from '@/lib/llm/handlers/adminProviders'
import { InputError, isPrivateHost, normalizeEndpointUrl, validateEndpointUrl, validateModels } from '@/lib/llm/handlers/validate'

beforeEach(() => {
  process.env.LLM_PROVIDER_SECRET = 'validate-test-secret'
  delete process.env.PLAN_AGENT_API_KEY
  delete process.env.GEMINI_API_KEY
})

describe('isPrivateHost / validateEndpointUrl (SSRF guard)', () => {
  it('rejects IPv6 loopback, ULA, link-local and hex-form IPv4-mapped private addresses', () => {
    // URL 规范化后 hostname 仍带方括号，与 isPrivateHost 的输入契约一致
    expect(isPrivateHost('[::1]')).toBe(true)
    expect(isPrivateHost('[fc00::1]')).toBe(true)
    expect(isPrivateHost('[fd12:3456::1]')).toBe(true)
    expect(isPrivateHost('[fe80::1]')).toBe(true)
    expect(isPrivateHost('[::]')).toBe(true)
    // ::ffff:169.254.169.254 会被 URL 规范化成十六进制形态
    expect(isPrivateHost('[::ffff:a9fe:a9fe]')).toBe(true)
    expect(isPrivateHost('[::ffff:169.254.169.254]')).toBe(true)
    // ::ffff:127.0.0.1（回环）的十六进制形态
    expect(isPrivateHost('[::ffff:7f00:1]')).toBe(true)
    expect(isPrivateHost('[::ffff:10.1.2.3]')).toBe(true)
    expect(isPrivateHost('[::ffff:192.168.0.1]')).toBe(true)
    expect(isPrivateHost('[::ffff:100.64.0.1]')).toBe(true)
    expect(isPrivateHost('[::ffff:0.0.0.0]')).toBe(true)
  })

  it('allows public IPv6 (including public IPv4-mapped) and public hostnames', () => {
    expect(isPrivateHost('[2606:4700:4700::1111]')).toBe(false)
    expect(isPrivateHost('[::ffff:8.8.8.8]')).toBe(false)
    expect(isPrivateHost('[::ffff:1.1.1.1]')).toBe(false)
    expect(isPrivateHost('api.openai.com')).toBe(false)
    expect(isPrivateHost('relay.example.com')).toBe(false)
  })

  it('still rejects IPv4/dotted special ranges and localhost-like names', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('foo.localhost')).toBe(true)
    expect(isPrivateHost('foo.internal')).toBe(true)
    expect(isPrivateHost('127.0.0.1')).toBe(true)
    expect(isPrivateHost('10.1.2.3')).toBe(true)
    expect(isPrivateHost('192.168.0.10')).toBe(true)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('169.254.169.254')).toBe(true)
    expect(isPrivateHost('100.64.0.1')).toBe(true)
    expect(isPrivateHost('0.0.0.0')).toBe(true)
  })

  it('validateEndpointUrl rejects the same set after URL normalization (127.1 etc.)', () => {
    const bad = [
      'https://[::1]/v1',
      'https://[fc00::1]/v1',
      'https://[fe80::1]/v1',
      'https://[::ffff:a9fe:a9fe]/v1',
      'https://[::ffff:7f00:1]/v1',
      'https://[::ffff:169.254.169.254]/v1',
      'https://localhost:3000/v1',
      'https://foo.internal/v1',
      'https://100.64.0.1/v1',
      'https://0.0.0.0/v1',
      // URL 规范化把 127.1 展开成 127.0.0.1，仍要拒
      'https://127.1/v1',
    ]
    for (const url of bad) {
      expect(() => validateEndpointUrl(url)).toThrow(InputError)
    }

    expect(validateEndpointUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    )
  })
})

describe('normalizeEndpointUrl（第七轮 A4：基地址 → 完整请求 URL）', () => {
  it('openai：基地址/带 /v1/完整路径三种输入归一到同一条完整 URL，尾部斜杠被去掉', () => {
    expect(normalizeEndpointUrl('openai', 'https://x.example.com')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1/')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    // 已是完整路径 → 原样（幂等）
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1/chat/completions')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    // sub2api 形态的基地址
    expect(normalizeEndpointUrl('openai', 'https://gw.sub2api.example.com/v1')).toBe(
      'https://gw.sub2api.example.com/v1/chat/completions',
    )
    // DeepSeek：裸域与 /v1 归一到同一条
    expect(normalizeEndpointUrl('openai', 'https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://api.deepseek.com/v1')).toBe(
      normalizeEndpointUrl('openai', 'https://api.deepseek.com'),
    )
    // 非 /v1 的自定义前缀：只追加后缀，不再插入 /v1（M4）
    expect(normalizeEndpointUrl('openai', 'https://relay.example.com/openai')).toBe(
      'https://relay.example.com/openai/chat/completions',
    )
  })

  it('M4：非空路径只追加后缀（v1beta/openai、/v1、/api 五种输入），不再插入 /v1', () => {
    // Gemini OpenAI 兼容端点
    expect(normalizeEndpointUrl('openai', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1')).toBe(
      'https://x.example.com/v1/chat/completions',
    )
    expect(normalizeEndpointUrl('openai', 'https://relay.example.com/api')).toBe(
      'https://relay.example.com/api/chat/completions',
    )
    // 空路径与已完整路径（五种输入的另外两种）见上一用例：空路径补 /v1/chat/completions、
    // 已完整后缀原样返回
  })

  it('M4：后缀比较大写不敏感、端口保留、已完整的大写 anthropic URL 原样', () => {
    // 大写 /V1：旧规则会插 /v1 拼出 /V1/v1/chat/completions，新规则只追加后缀
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/V1')).toBe(
      'https://x.example.com/V1/chat/completions',
    )
    // 端口保留
    expect(normalizeEndpointUrl('openai', 'https://relay.example.com:8443/api')).toBe(
      'https://relay.example.com:8443/api/chat/completions',
    )
    // 已完整（大小写不敏感比较）→ 原样
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1/Chat/Completions')).toBe(
      'https://x.example.com/v1/Chat/Completions',
    )
    expect(normalizeEndpointUrl('anthropic', 'https://gw.example.com/V1/Messages')).toBe(
      'https://gw.example.com/V1/Messages',
    )
  })

  it('L7：normalizeEndpointUrl 内部即做 https/私网守卫，绕过 validateEndpointUrl 也会被拦', () => {
    expect(() => normalizeEndpointUrl('openai', 'http://x.example.com/v1')).toThrow(InputError)
    expect(() => normalizeEndpointUrl('openai', 'https://127.0.0.1:3000/v1')).toThrow(InputError)
    expect(() => normalizeEndpointUrl('anthropic', 'https://[::ffff:a9fe:a9fe]/v1')).toThrow(InputError)
    try {
      normalizeEndpointUrl('openai', 'https://192.168.0.10/v1')
      throw new Error('unreachable')
    } catch (err) {
      expect(err).toBeInstanceOf(InputError)
      expect((err as InputError).message).toContain('内网')
    }
  })

  it('anthropic：同规则归一到 /v1/messages', () => {
    expect(normalizeEndpointUrl('anthropic', 'https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(normalizeEndpointUrl('anthropic', 'https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(normalizeEndpointUrl('anthropic', 'https://gw.example.com/v1/messages')).toBe(
      'https://gw.example.com/v1/messages',
    )
    expect(normalizeEndpointUrl('anthropic', 'https://gw.example.com/v1/')).toBe(
      'https://gw.example.com/v1/messages',
    )
  })

  it('保留 query；空串/畸形输入抛 InputError', () => {
    expect(normalizeEndpointUrl('openai', 'https://x.example.com/v1?foo=bar')).toBe(
      'https://x.example.com/v1/chat/completions?foo=bar',
    )
    expect(() => normalizeEndpointUrl('openai', '')).toThrow(InputError)
    expect(() => normalizeEndpointUrl('openai', 'not-a-url')).toThrow(InputError)
  })
})

describe('validateModels 价格字段透传（P1）', () => {
  it('合法价格字段原样保留入库；null 视为显式未填被剥掉；不填不受影响', () => {
    const models = validateModels([
      { name: 'm', contextLength: 128000, inputMissPerM: 300_000, inputCacheHitPerM: 6_000, outputPerM: 1_200_000 },
      { name: 'n', contextLength: 128000, inputMissPerM: null },
      { name: 'o', contextLength: 64000, maxOutputTokens: 8192 },
    ])
    expect(models[0]).toEqual({
      name: 'm',
      contextLength: 128000,
      inputMissPerM: 300_000,
      inputCacheHitPerM: 6_000,
      outputPerM: 1_200_000,
    })
    expect(models[1]).toEqual({ name: 'n', contextLength: 128000 })
    expect(models[2]).toEqual({ name: 'o', contextLength: 64000, maxOutputTokens: 8192 })
  })

  it('负数 / 非有限数 / 超上限的价格拒绝（400）', () => {
    for (const bad of [-1, Number.POSITIVE_INFINITY, Number.NaN, 'x', 1e12]) {
      expect(() => validateModels([{ name: 'm', contextLength: 128000, outputPerM: bad }])).toThrow(InputError)
      expect(() => validateModels([{ name: 'm', contextLength: 128000, inputMissPerM: bad }])).toThrow(InputError)
      expect(() => validateModels([{ name: 'm', contextLength: 128000, inputCacheHitPerM: bad }])).toThrow(InputError)
    }
  })
})

describe('PUT with a bad endpoint URL returns 400', () => {
  it('rejects hex-form IPv4-mapped metadata addresses on the update path', async () => {
    const deps: LlmAdminApiDeps = {
      getSession: async () => ({ user: { isAdmin: true } }),
      repo: createMemoryLlmProviderRepo(),
    }
    const handlers = createHandlers(deps)
    const created = await handlers.POST(
      new Request('http://localhost/api/admin/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '我的中转',
          protocol: 'openai',
          endpointUrl: 'https://relay.example.com/v1/chat/completions',
          apiKey: 'sk-abcdef123456',
          models: [{ name: 'gpt-mini', contextLength: 128000 }],
        }),
      }),
    )
    const id = ((await created.json()) as { provider: { id: string } }).provider.id

    const res = await handlers.PUT(
      new Request('http://localhost/api/admin/llm/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpointUrl: 'https://[::ffff:a9fe:a9fe]/v1/chat/completions' }),
      }),
      id,
    )
    expect(res.status).toBe(400)
    const data = (await res.json()) as { error: string }
    expect(data.error).toContain('内网')
  })
})
