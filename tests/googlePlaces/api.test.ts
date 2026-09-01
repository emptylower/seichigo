import { describe, it, expect, afterEach } from 'vitest'
import { getGooglePlacesApiDeps } from '@/lib/googlePlaces/api'

/**
 * Cloudflare 的 ctx.waitUntil 是请求级绑定。这里确定性验证：
 * deps 永远携带"当前"请求的 waitUntil，跨请求绝不缓存旧引用。
 */
const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

type TestGlobal = typeof globalThis & {
  [CLOUDFLARE_CONTEXT_SYMBOL]?: unknown
}

function setFakeCloudflareContext(value: unknown) {
  ;(globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL] = value
}

afterEach(() => {
  delete (globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL]
})

describe('getGooglePlacesApiDeps（请求级 waitUntil，不缓存旧请求上下文）', () => {
  it('第一个请求的 waitUntil 不会被缓存给后续请求', async () => {
    const firstWaitUntil = (() => undefined) as (p: Promise<unknown>) => void
    const secondWaitUntil = (() => undefined) as (p: Promise<unknown>) => void

    setFakeCloudflareContext({ ctx: { waitUntil: firstWaitUntil } })
    const deps1 = await getGooglePlacesApiDeps()
    expect(deps1.waitUntil).toBe(firstWaitUntil)

    // 模拟新请求接管：绑定换成第二个请求的 ctx
    setFakeCloudflareContext({ ctx: { waitUntil: secondWaitUntil } })
    const deps2 = await getGooglePlacesApiDeps()
    expect(deps2.waitUntil).toBe(secondWaitUntil)
    expect(deps2.waitUntil).not.toBe(firstWaitUntil)

    // 稳定部分（getSession/apiKey）跨请求复用，不受影响
    expect(deps1.getSession).toBe(deps2.getSession)
    expect(deps1.apiKey).toBe(deps2.apiKey)
  })

  it('当前请求没有 bindings 时 waitUntil 缺省（镜像降级为浮动 promise），不残留旧值', async () => {
    setFakeCloudflareContext({ ctx: { waitUntil: (() => undefined) as (p: Promise<unknown>) => void } })
    const withBinding = await getGooglePlacesApiDeps()
    expect(withBinding.waitUntil).toBeDefined()

    delete (globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL]
    const withoutBinding = await getGooglePlacesApiDeps()
    expect(withoutBinding.waitUntil).toBeUndefined()
  })
})
