import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProviderView } from '@/app/(authed)/admin/llm/types'

const getSessionMock = vi.fn()
const redirectMock = vi.fn()
const askForConfirmMock = vi.fn(async () => true)

vi.mock('@/lib/auth/session', () => ({
  getServerAuthSession: () => getSessionMock(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

vi.mock('@/hooks/useAdminConfirm', () => ({
  useAdminConfirm: () => askForConfirmMock,
}))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeProvider(overrides: Partial<LlmProviderView> = {}): LlmProviderView {
  return {
    id: 'p1',
    name: 'DeepSeek 主',
    protocol: 'openai',
    endpointUrl: 'https://api.deepseek.com/chat/completions',
    apiKeyHint: 'sk-…a1b2',
    hasApiKey: true,
    models: [{ name: 'deepseek-v4-flash', contextLength: 128000, maxOutputTokens: 32768 }],
    takeover: { agent: false, translation: false },
    agentModel: null,
    translationModel: null,
    source: 'env',
    enabled: true,
    lastTest: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const providerP1 = makeProvider()
const providerP2 = makeProvider({
  id: 'p2',
  name: 'Claude 备用',
  protocol: 'anthropic',
  endpointUrl: 'https://api.anthropic.com/v1/messages',
  apiKeyHint: null,
  hasApiKey: false,
  source: 'custom',
  models: [{ name: 'claude-sonnet-4', contextLength: 200000, maxOutputTokens: null }],
})

type FetchCall = { url: string; init?: RequestInit }

function installFetchMock() {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const method = init?.method || 'GET'
    if (url === '/api/admin/llm/providers' && method === 'GET') {
      return jsonResponse({
        ok: true,
        providers: [providerP1, providerP2],
        effective: { agent: null, translation: null },
      })
    }
    if (url === '/api/admin/llm/providers/p1/test' && method === 'POST') {
      return jsonResponse({ ok: true, result: { ok: true, latencyMs: 123, message: null, sample: 'OK' } })
    }
    if (url.startsWith('/api/admin/llm/providers/') && method === 'PUT') {
      return jsonResponse({ ok: true, provider: providerP1 })
    }
    if (url === '/api/admin/llm/providers' && method === 'POST') {
      return jsonResponse({ ok: true, provider: providerP1 })
    }
    if (url.startsWith('/api/admin/llm/providers/') && method === 'DELETE') {
      return jsonResponse({ ok: true })
    }
    return jsonResponse({ error: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

function cardOf(name: string): HTMLElement {
  const el = screen.getByText(name).closest('[data-testid^="llm-provider-"]')
  expect(el).not.toBeNull()
  return el as HTMLElement
}

describe('admin llm page auth', () => {
  beforeEach(() => {
    getSessionMock.mockReset()
    redirectMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('redirects to signin when no session', async () => {
    getSessionMock.mockResolvedValue(null)
    const AdminLlmPage = (await import('@/app/(authed)/admin/llm/page')).default
    try {
      await AdminLlmPage()
    } catch {
      // redirect 在 Next.js 中会抛错，mock 下继续执行会触发空引用，忽略
    }
    expect(redirectMock).toHaveBeenCalledWith('/auth/signin')
  })

  it('shows forbidden for non-admin', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } })
    const AdminLlmPage = (await import('@/app/(authed)/admin/llm/page')).default
    const { container } = render(await AdminLlmPage())
    expect(container).toHaveTextContent('无权限访问。')
  })
})

describe('admin llm UI', () => {
  beforeEach(() => {
    askForConfirmMock.mockReset()
    askForConfirmMock.mockResolvedValue(true)
    vi.unstubAllGlobals()
  })

  it('渲染两张供应商卡片', async () => {
    installFetchMock()
    const { default: AdminLlmClient } = await import('@/app/(authed)/admin/llm/ui')
    render(<AdminLlmClient />)

    expect(await screen.findByText('DeepSeek 主')).toBeInTheDocument()
    expect(screen.getByText('Claude 备用')).toBeInTheDocument()
    expect(screen.getByText('OpenAI 兼容')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(screen.getByText(/sk-…a1b2/)).toBeInTheDocument()
    expect(screen.getByText(/未设置/)).toBeInTheDocument()
  })

  it('点击「测试」发送 POST 并显示延迟', async () => {
    const { calls } = installFetchMock()
    const { default: AdminLlmClient } = await import('@/app/(authed)/admin/llm/ui')
    render(<AdminLlmClient />)

    await screen.findByText('DeepSeek 主')
    const card = cardOf('DeepSeek 主')
    fireEvent.click(within(card).getByRole('button', { name: '测试' }))

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/api/admin/llm/providers/p1/test' && c.init?.method === 'POST')
      expect(post).toBeTruthy()
      expect(JSON.parse(String(post?.init?.body))).toEqual({ model: 'deepseek-v4-flash' })
    })
    expect(await within(card).findByText('123 ms')).toBeInTheDocument()
  })

  it('勾选「接管 Agent」发送 PUT 且含 takeover.agent 与 agentModel', async () => {
    const { calls } = installFetchMock()
    const { default: AdminLlmClient } = await import('@/app/(authed)/admin/llm/ui')
    render(<AdminLlmClient />)

    await screen.findByText('DeepSeek 主')
    const card = cardOf('DeepSeek 主')
    fireEvent.click(within(card).getByLabelText('接管 Agent'))

    await waitFor(() => {
      const put = calls.find((c) => c.url === '/api/admin/llm/providers/p1' && c.init?.method === 'PUT')
      expect(put).toBeTruthy()
      expect(JSON.parse(String(put?.init?.body))).toMatchObject({
        takeover: { agent: true },
        agentModel: 'deepseek-v4-flash',
      })
    })
  })

  it('新建表单拦截 http URL 并显示错误，不发送 POST', async () => {
    const { calls } = installFetchMock()
    const { default: AdminLlmClient } = await import('@/app/(authed)/admin/llm/ui')
    render(<AdminLlmClient />)

    await screen.findByText('DeepSeek 主')
    fireEvent.click(screen.getByRole('button', { name: '新建供应商' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('供应商名称'), { target: { value: '测试供应商' } })
    fireEvent.change(within(dialog).getByLabelText('请求完整 URL'), {
      target: { value: 'http://api.example.com/v1/chat/completions' },
    })
    fireEvent.change(within(dialog).getByLabelText('API key'), { target: { value: 'sk-test-key' } })
    fireEvent.change(within(dialog).getByLabelText('模型名 1'), { target: { value: 'my-model' } })
    fireEvent.change(within(dialog).getByLabelText('上下文长度 1'), { target: { value: '128000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(await within(dialog).findByText(/https/)).toBeInTheDocument()
    expect(calls.filter((c) => c.url === '/api/admin/llm/providers' && c.init?.method === 'POST')).toHaveLength(0)
  })

  it('编辑时 API key 留空则不发送 apiKey 字段', async () => {
    const { calls } = installFetchMock()
    const { default: AdminLlmClient } = await import('@/app/(authed)/admin/llm/ui')
    render(<AdminLlmClient />)

    await screen.findByText('DeepSeek 主')
    const card = cardOf('DeepSeek 主')
    fireEvent.click(within(card).getByRole('button', { name: '编辑' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('供应商名称')).toHaveValue('DeepSeek 主')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      const put = calls.find((c) => c.url === '/api/admin/llm/providers/p1' && c.init?.method === 'PUT')
      expect(put).toBeTruthy()
      const body = JSON.parse(String(put?.init?.body)) as Record<string, unknown>
      expect(body).not.toHaveProperty('apiKey')
      expect(body).toMatchObject({ name: 'DeepSeek 主', protocol: 'openai' })
    })
  })
})
