import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_RUN_TIMEOUT_MS,
  readBrowserRunConfig,
  renderHtmlToWebp,
} from '@/lib/share/browserRun'

const CONFIG = { accountId: 'acct123', token: 'tok456' }

function imageResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/webp' } })
}

describe('readBrowserRunConfig', () => {
  it('两个变量都在时返回配置', () => {
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: ' t ', CF_ACCOUNT_ID: ' a ' })).toEqual({
      token: 't',
      accountId: 'a',
    })
  })

  it('任一缺失返回 null', () => {
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: 't' })).toBeNull()
    expect(readBrowserRunConfig({ CF_ACCOUNT_ID: 'a' })).toBeNull()
    expect(readBrowserRunConfig({ BROWSER_RUN_TOKEN: '  ', CF_ACCOUNT_ID: 'a' })).toBeNull()
  })
})

describe('renderHtmlToWebp', () => {
  it('按实测形状发请求并返回字节', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const fetchImpl = vi.fn(async () => imageResponse(bytes))
    const out = await renderHtmlToWebp({
      html: '<html></html>',
      width: 1200,
      height: 630,
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(out).toEqual(bytes)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct123/browser-run/screenshot')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok456')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      html: '<html></html>',
      screenshotOptions: { type: 'webp', quality: 85 },
      viewport: { width: 1200, height: 630 },
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('非 2xx 返回 null', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }))
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('200 但返回 JSON 错误体也算失败', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, errors: [{ message: 'boom' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('空响应体算失败', async () => {
    const fetchImpl = vi.fn(async () => imageResponse(new Uint8Array()))
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('抛错（超时/网络）返回 null 不外泄异常', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('timeout', 'TimeoutError')
    })
    expect(
      await renderHtmlToWebp({
        html: 'x',
        width: 1200,
        height: 630,
        config: CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).toBeNull()
  })

  it('超时设成 20 秒', () => {
    expect(BROWSER_RUN_TIMEOUT_MS).toBe(20_000)
  })
})
