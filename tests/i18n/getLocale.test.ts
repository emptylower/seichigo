import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn() }))

import { headers } from 'next/headers'
import { getLocale } from '@/lib/i18n/getLocale'

function mockRequestHeaders(init: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue(new Headers(init))
}

describe('getLocale', () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset()
  })

  it('优先返回合法的 x-seichigo-locale 请求头', async () => {
    mockRequestHeaders({ 'x-seichigo-locale': 'en', 'accept-language': 'zh-CN' })
    expect(await getLocale()).toBe('en')
  })

  it('非法头值忽略，回落 accept-language', async () => {
    mockRequestHeaders({ 'x-seichigo-locale': 'fr', 'accept-language': 'ja' })
    expect(await getLocale()).toBe('ja')
  })

  it('无头无 accept-language 时兜底 zh', async () => {
    mockRequestHeaders({})
    expect(await getLocale()).toBe('zh')
  })
})
