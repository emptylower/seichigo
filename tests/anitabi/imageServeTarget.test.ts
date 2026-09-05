import { describe, expect, it } from 'vitest'
import { resolveProxyTargetUrl } from '@/lib/anitabi/handlers/imageServeTarget'

/**
 * 第六轮 E1：三种客户端形态（单次编码完整 / 平台已解码一次导致截断 /
 * 双重编码）都必须解析出完整目标 URL，R2 mirror key 才能与种子任务对齐。
 */

const PROXY_BASE = 'http://localhost/api/anitabi/image-render'
const FULL_TARGET = 'https://image.anitabi.cn/points/demo.jpg?q=80&w=640'

function requestFromRawQuery(rawQuery: string): Request {
  return new Request(`${PROXY_BASE}?${rawQuery}`)
}

describe('resolveProxyTargetUrl', () => {
  it('单次编码完整：解一次即得完整目标', () => {
    const req = requestFromRawQuery(`url=${encodeURIComponent(FULL_TARGET)}`)
    expect(resolveProxyTargetUrl(req)?.toString()).toBe(FULL_TARGET)
  })

  it('平台已解码一次导致截断：url 值在第一个 & 处断开，w=640 被并回目标 query', () => {
    // Cloudflare/OpenNext 上 req.url 的 query 已被平台解码过一次：
    // url=https://image.anitabi.cn/points/demo.jpg?q=80&w=640
    const req = requestFromRawQuery(`url=${FULL_TARGET}`)
    expect(resolveProxyTargetUrl(req)?.toString()).toBe(FULL_TARGET)
  })

  it('双重编码：解两次得完整目标', () => {
    const req = requestFromRawQuery(`url=${encodeURIComponent(encodeURIComponent(FULL_TARGET))}`)
    expect(resolveProxyTargetUrl(req)?.toString()).toBe(FULL_TARGET)
  })

  it('_retry 与 __mi_* 参数不被误并入目标', () => {
    const req = requestFromRawQuery(
      `url=${encodeURIComponent(FULL_TARGET)}&_retry=1&__mi_session=s1&__mi_chain=c1`,
    )
    const target = resolveProxyTargetUrl(req)
    expect(target?.toString()).toBe(FULL_TARGET)
    expect(target?.searchParams.has('_retry')).toBe(false)
    expect(target?.searchParams.has('__mi_session')).toBe(false)
  })

  it('截断形态下代理自有参数（_retry/__mi_*）同样不并入，只有非代理参数回填', () => {
    const req = requestFromRawQuery(`url=${FULL_TARGET}&_retry=1&__mi_request=r1`)
    const target = resolveProxyTargetUrl(req)
    // 截断捕获到 "...jpg?q=80"，w=640 回填；_retry/__mi_* 排除
    expect(target?.toString()).toBe(FULL_TARGET)
  })

  it('目标 query 里已有的键不重复追加', () => {
    // 单次编码的目标自带 w=640，顶层又跟着 w=640（历史坏链形态）：只保留一份
    const req = requestFromRawQuery(
      `url=${encodeURIComponent('https://image.anitabi.cn/points/demo.jpg?w=640')}&q=80&w=640`,
    )
    const target = resolveProxyTargetUrl(req)
    expect(target?.toString()).toBe('https://image.anitabi.cn/points/demo.jpg?w=640&q=80')
    expect(target?.searchParams.getAll('w')).toEqual(['640'])
  })

  it('缺少 url 参数时返回 null', () => {
    expect(resolveProxyTargetUrl(new Request(PROXY_BASE))).toBeNull()
    expect(resolveProxyTargetUrl(requestFromRawQuery('other=foo'))).toBeNull()
  })

  it('非 http(s) 协议与带凭据的目标返回 null（沿用 parseTargetUrl 口径）', () => {
    expect(
      resolveProxyTargetUrl(requestFromRawQuery(`url=${encodeURIComponent('ftp://bgm.tv/a.jpg')}`)),
    ).toBeNull()
    expect(
      resolveProxyTargetUrl(
        requestFromRawQuery(`url=${encodeURIComponent('https://user:pass@bgm.tv/a.jpg')}`),
      ),
    ).toBeNull()
  })
})
