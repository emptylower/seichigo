import { describe, it, expect, vi } from 'vitest'
import { CreemApiError, createCreemClient, readCreemConfig, type CreemConfig } from '@/lib/billing/creem/client'

/**
 * D3：Creem 客户端（原生 fetch）。字段名、URL、header、映射与错误路径。
 */

const CONFIG: CreemConfig = {
  apiKey: 'creem_test_key',
  apiBase: 'https://test-api.creem.io',
  productStandardId: 'prod_standard',
  webhookSecret: 'whsec_test',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function makeFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(handler as unknown as typeof fetch)
}

describe('readCreemConfig', () => {
  it('四项齐全返回配置', () => {
    expect(
      readCreemConfig({
        CREEM_API_KEY: 'k',
        CREEM_API_BASE: 'https://test-api.creem.io',
        CREEM_PRODUCT_STANDARD_ID: 'p',
        CREEM_WEBHOOK_SECRET: 's',
      }),
    ).toEqual({ apiKey: 'k', apiBase: 'https://test-api.creem.io', productStandardId: 'p', webhookSecret: 's' })
  })

  it('缺任意一项返回 null', () => {
    const base = {
      CREEM_API_KEY: 'k',
      CREEM_API_BASE: 'https://test-api.creem.io',
      CREEM_PRODUCT_STANDARD_ID: 'p',
      CREEM_WEBHOOK_SECRET: 's',
    }
    expect(readCreemConfig({ ...base, CREEM_API_KEY: '' })).toBeNull()
    expect(readCreemConfig({ ...base, CREEM_API_BASE: undefined })).toBeNull()
    expect(readCreemConfig({ ...base, CREEM_PRODUCT_STANDARD_ID: '  ' })).toBeNull()
    expect(readCreemConfig({ ...base, CREEM_WEBHOOK_SECRET: undefined })).toBeNull()
  })
})

describe('createCheckout', () => {
  it('请求 URL/header/body 字段正确并映射 checkout_url', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse(200, { id: 'ch_1', checkout_url: 'https://test.creem.io/checkout/ch_1', status: 'pending' }),
    )
    const client = createCreemClient(CONFIG, fetchImpl)
    const result = await client.createCheckout({
      productId: 'prod_standard',
      requestId: 'u1:abc',
      successUrl: 'https://seichigo.com/me?billing=success',
      customerEmail: 'u@example.com',
      metadata: { userId: 'u1', tier: 'standard' },
    })

    expect(result).toEqual({ id: 'ch_1', checkoutUrl: 'https://test.creem.io/checkout/ch_1' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-api.creem.io/v1/checkouts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('creem_test_key')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({
      product_id: 'prod_standard',
      request_id: 'u1:abc',
      success_url: 'https://seichigo.com/me?billing=success',
      customer: { email: 'u@example.com' },
      metadata: { userId: 'u1', tier: 'standard' },
    })
  })

  it('非 2xx 抛 CreemApiError（带 status 与 bodyText）', async () => {
    const fetchImpl = makeFetch(() => new Response('{"error":"invalid product"}', { status: 400 }))
    const client = createCreemClient(CONFIG, fetchImpl)
    const err = await client.createCheckout({
      productId: 'prod_bad',
      requestId: 'u1:abc',
      successUrl: 'https://seichigo.com/me',
      customerEmail: 'u@example.com',
      metadata: {},
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CreemApiError)
    expect((err as CreemApiError).status).toBe(400)
    expect((err as CreemApiError).bodyText).toContain('invalid product')
  })
})

describe('createBillingPortal', () => {
  it('请求 customer_id 并取 customer_portal_link', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse(200, { customer_portal_link: 'https://portal.creem.io/x', id: 'cus_1' }),
    )
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).resolves.toEqual({ portalUrl: 'https://portal.creem.io/x' })
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-api.creem.io/v1/customers/billing')
    expect(JSON.parse(String(init.body))).toEqual({ customer_id: 'cus_1' })
  })

  it('无 customer_portal_link 时按白名单 portal_url 兜底', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse(200, { id: 'cus_1', link: 'not-a-url', portal_url: 'https://portal.creem.io/fallback' }),
    )
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).resolves.toEqual({ portalUrl: 'https://portal.creem.io/fallback' })
  })

  it('F6：白名单第三个键 url 也可作为兜底', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'cus_1', url: 'https://portal.creem.io/by-url' }))
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).resolves.toEqual({ portalUrl: 'https://portal.creem.io/by-url' })
  })

  it('F6：含无关 http:// 字段的响应不被误选（必须 https）', async () => {
    const fetchImpl = makeFetch(() =>
      jsonResponse(200, {
        id: 'cus_1',
        customer_portal_link: 'http://portal.creem.io/insecure',
        portal_url: 'http://portal.creem.io/insecure-too',
        url: 'http://evil.example.com/x',
        link: 'http://evil.example.com/y',
      }),
    )
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).rejects.toBeInstanceOf(CreemApiError)
  })

  it('F6：白名单键都不存在时抛 CreemApiError（不取任意 http 字段）', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'cus_1', link: 'http://some.example.com/z' }))
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).rejects.toBeInstanceOf(CreemApiError)
  })

  it('没有任何链接时抛错', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'cus_1' }))
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.createBillingPortal('cus_1')).rejects.toThrow()
  })
})

describe('getSubscription', () => {
  it('GET /v1/subscriptions/{id} 返回对象', async () => {
    const fetchImpl = makeFetch(() => jsonResponse(200, { id: 'sub_1', status: 'active' }))
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.getSubscription('sub_1')).resolves.toEqual({ id: 'sub_1', status: 'active' })
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-api.creem.io/v1/subscriptions/sub_1')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('creem_test_key')
  })

  it('404 返回 null', async () => {
    const fetchImpl = makeFetch(() => new Response('not found', { status: 404 }))
    const client = createCreemClient(CONFIG, fetchImpl)
    await expect(client.getSubscription('sub_missing')).resolves.toBeNull()
  })

  it('其它非 2xx 抛 CreemApiError', async () => {
    const fetchImpl = makeFetch(() => new Response('boom', { status: 500 }))
    const client = createCreemClient(CONFIG, fetchImpl)
    const err = await client.getSubscription('sub_1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CreemApiError)
    expect((err as CreemApiError).status).toBe(500)
  })
})
