import { describe, it, expect, afterEach } from 'vitest'
import { getGooglePlacesApiDeps, getGooglePointPhotoDeps } from '@/lib/googlePlaces/api'

/**
 * Cloudflare 的 ctx.waitUntil 是请求级绑定。这里确定性验证：
 * deps 永远携带"当前"请求的 waitUntil，跨请求绝不缓存旧引用。
 *
 * 回归第五轮 R1：ctx.waitUntil 脱离 ctx 调用会抛 "Illegal invocation"
 * （Cloudflare 上所有地点图 500 的根因）。注入的 waitUntil 方法严格校验
 * `this === ctx`，经 api.ts 装配后的 waitUntil 闭包必须原样转发、不抛。
 */

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for('__cloudflare-context__')

type TestGlobal = typeof globalThis & {
  [CLOUDFLARE_CONTEXT_SYMBOL]?: unknown
}

function setFakeCloudflareContext(value: unknown) {
  ;(globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL] = value
}

/** 严格 ctx：waitUntil 以方法形式定义并校验 this，脱离 ctx 调用即抛 Illegal invocation */
function makeStrictContext() {
  const ctx = {
    received: [] as Promise<unknown>[],
    waitUntil(this: { received: Promise<unknown>[] }, promise: Promise<unknown>) {
      if (this !== ctx) {
        throw new TypeError("Illegal invocation: function called with incorrect 'this' reference")
      }
      this.received.push(promise)
    },
  }
  return ctx
}

afterEach(() => {
  delete (globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL]
})

describe('getGooglePlacesApiDeps（请求级 waitUntil，不缓存旧请求上下文）', () => {
  it('注入的 waitUntil 校验 this===ctx：经 deps 取到的 waitUntil 调用不抛（R1 闭包转发）', async () => {
    const ctx = makeStrictContext()
    setFakeCloudflareContext({ ctx })
    const deps = await getGooglePlacesApiDeps()
    expect(deps.waitUntil).toBeDefined()
    expect(() => deps.waitUntil!(Promise.resolve('x'))).not.toThrow()
    await Promise.all(ctx.received)
    expect(ctx.received).toHaveLength(1)
  })

  it('第一个请求的 waitUntil 不会被缓存给后续请求', async () => {
    const first = makeStrictContext()
    const second = makeStrictContext()

    setFakeCloudflareContext({ ctx: first })
    const deps1 = await getGooglePlacesApiDeps()
    deps1.waitUntil?.(Promise.resolve('a'))
    expect(first.received).toHaveLength(1)

    // 模拟新请求接管：绑定换成第二个请求的 ctx；deps2 只派发到 second
    setFakeCloudflareContext({ ctx: second })
    const deps2 = await getGooglePlacesApiDeps()
    deps2.waitUntil?.(Promise.resolve('b'))
    expect(second.received).toHaveLength(1)
    expect(first.received).toHaveLength(1)

    // 稳定部分（getSession/apiKey）跨请求复用，不受影响
    expect(deps1.getSession).toBe(deps2.getSession)
    expect(deps1.apiKey).toBe(deps2.apiKey)
  })

  it('当前请求没有 bindings 时 waitUntil 缺省（镜像降级为浮动 promise），不残留旧值', async () => {
    setFakeCloudflareContext({ ctx: makeStrictContext() })
    const withBinding = await getGooglePlacesApiDeps()
    expect(withBinding.waitUntil).toBeDefined()

    delete (globalThis as TestGlobal)[CLOUDFLARE_CONTEXT_SYMBOL]
    const withoutBinding = await getGooglePlacesApiDeps()
    expect(withoutBinding.waitUntil).toBeUndefined()
  })
})

describe('getGooglePointPhotoDeps（点位兜底图，同款 waitUntil 闭包）', () => {
  it('point-photo 的 waitUntil 同样以 ctx 为 this 转发，调用不抛', async () => {
    const ctx = makeStrictContext()
    setFakeCloudflareContext({ ctx })
    const deps = await getGooglePointPhotoDeps()
    expect(deps.waitUntil).toBeDefined()
    expect(() => deps.waitUntil!(Promise.resolve('y'))).not.toThrow()
    expect(ctx.received).toHaveLength(1)
  })
})
