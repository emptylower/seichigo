import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryLlmProviderRepo } from '@/lib/llm/repoMemory'
import { createHandlers, type LlmAdminApiDeps } from '@/lib/llm/handlers/adminProviders'
import { InputError, isPrivateHost, validateEndpointUrl } from '@/lib/llm/handlers/validate'

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
