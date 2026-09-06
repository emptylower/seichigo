/**
 * Creem API 客户端（设计 2026-09-06 §2）：原生 fetch，不引入 SDK。
 * 测试基址 https://test-api.creem.io，生产 https://api.creem.io。
 */

export type CreemConfig = {
  apiKey: string
  apiBase: string
  productStandardId: string
  webhookSecret: string
}

/** Creem 订阅对象（GetSubscription 与 webhook object 的公共形状；字段尽量宽松） */
export type CreemSubscriptionObject = {
  id: string
  status?: string
  current_period_start_date?: number
  current_period_end_date?: number
  last_transaction_date?: number
  next_transaction_date?: number
  canceled_at?: number | null
  request_id?: string | null
  metadata?: Record<string, unknown>
  customer?: { id?: string; email?: string } | null
  product?: { id?: string } | null
  [key: string]: unknown
}

export type CreemCheckoutResult = { id: string; checkoutUrl: string }

export type CreemClient = ReturnType<typeof createCreemClient>

export class CreemApiError extends Error {
  readonly status: number
  readonly bodyText: string

  constructor(status: number, bodyText: string) {
    super(`Creem API error ${status}: ${bodyText.slice(0, 200)}`)
    this.name = 'CreemApiError'
    this.status = status
    this.bodyText = bodyText
  }
}

export function readCreemConfig(env: Record<string, string | undefined> = process.env): CreemConfig | null {
  const apiKey = env.CREEM_API_KEY?.trim()
  const apiBase = env.CREEM_API_BASE?.trim()
  const productStandardId = env.CREEM_PRODUCT_STANDARD_ID?.trim()
  const webhookSecret = env.CREEM_WEBHOOK_SECRET?.trim()
  if (!apiKey || !apiBase || !productStandardId || !webhookSecret) return null
  return { apiKey, apiBase, productStandardId, webhookSecret }
}

function extractPortalUrl(data: Record<string, unknown>): string {
  const primary = data.customer_portal_link
  if (typeof primary === 'string' && primary) return primary
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.startsWith('http')) return value
  }
  throw new Error('Creem billing portal response contains no portal link')
}

export function createCreemClient(config: CreemConfig, fetchImpl: typeof fetch = fetch) {
  async function request(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetchImpl(`${config.apiBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) throw new CreemApiError(res.status, await res.text())
    return (await res.json()) as Record<string, unknown>
  }

  return {
    async createCheckout(input: {
      productId: string
      requestId: string
      successUrl: string
      customerEmail: string
      metadata: Record<string, string>
    }): Promise<CreemCheckoutResult> {
      const data = await request('/v1/checkouts', 'POST', {
        product_id: input.productId,
        request_id: input.requestId,
        success_url: input.successUrl,
        customer: { email: input.customerEmail },
        metadata: input.metadata,
      })
      const id = typeof data.id === 'string' ? data.id : ''
      const checkoutUrl = typeof data.checkout_url === 'string' ? data.checkout_url : ''
      if (!id || !checkoutUrl) throw new CreemApiError(200, JSON.stringify(data))
      return { id, checkoutUrl }
    },

    async createBillingPortal(customerId: string): Promise<{ portalUrl: string }> {
      const data = await request('/v1/customers/billing', 'POST', { customer_id: customerId })
      return { portalUrl: extractPortalUrl(data) }
    },

    async getSubscription(subscriptionId: string): Promise<CreemSubscriptionObject | null> {
      const res = await fetchImpl(`${config.apiBase}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: 'GET',
        headers: { 'x-api-key': config.apiKey },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new CreemApiError(res.status, await res.text())
      return (await res.json()) as CreemSubscriptionObject
    },
  }
}
