import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPageCardDeps } from '@/lib/og/pageCardApi'

/** 生产 fetchImage 的失败分类（7-1）：永久失败才渲染无封面卡，临时失败走兜底 */

afterEach(() => vi.unstubAllGlobals())

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('pageCardApi fetchImage', () => {
  it.each([
    ['404', () => Promise.resolve(new Response('nope', { status: 404 })), 'missing'],
    ['410', () => Promise.resolve(new Response('gone', { status: 410 })), 'missing'],
    ['503', () => Promise.resolve(new Response('busy', { status: 503 })), 'transient'],
    ['429', () => Promise.resolve(new Response('slow down', { status: 429 })), 'transient'],
    ['网络异常/超时', () => Promise.reject(new DOMException('timeout', 'TimeoutError')), 'transient'],
    [
      'heic 类型不支持',
      () => Promise.resolve(new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/heic' } })),
      'missing',
    ],
    [
      'content-length 超内联上限',
      () =>
        Promise.resolve(
          new Response(new Uint8Array([1]), {
            headers: { 'content-type': 'image/jpeg', 'content-length': '999999999' },
          }),
        ),
      'missing',
    ],
  ] as const)('%s → %s', async (_name, impl, expected) => {
    stubFetch(impl)
    const deps = await getPageCardDeps()
    const result = await deps.fetchImage('https://example.com/a.jpg')
    expect(result.status).toBe(expected)
  })

  it('正常位图 → ok，content-type 去掉参数', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/PNG; charset=binary' } }),
      ),
    )
    const deps = await getPageCardDeps()
    const result = await deps.fetchImage('https://example.com/a.png')
    expect(result).toEqual({ status: 'ok', bytes: new Uint8Array([1, 2]), contentType: 'image/png' })
  })
})
