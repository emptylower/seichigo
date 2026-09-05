import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import {
  recordHostFailure,
  resetDegradedMapImageHostsForTest,
  resolveHostState,
} from '@/components/map/utils/mapImageHostPolicy'
import { resetLoadedMapImageCacheForTest } from '@/components/map/utils/mapImageLoadedCache'
import {
  acquireMapImageRequestSlot,
  resetMapImageRequestSchedulerForTest,
} from '@/features/map/anitabi/mapImageRequestScheduler'

const BREAKER_FLAG = 'NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED'

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advanceTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ResilientMapImage（2026-09 稳定性回归）', () => {
  const originalBreakerFlag = process.env[BREAKER_FLAG]

  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetLoadedMapImageCacheForTest()
    resetMapImageRequestSchedulerForTest()
    delete process.env[BREAKER_FLAG]
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetDegradedMapImageHostsForTest()
    resetLoadedMapImageCacheForTest()
    if (originalBreakerFlag === undefined) {
      delete process.env[BREAKER_FLAG]
      return
    }
    process.env[BREAKER_FLAG] = originalBreakerFlag
  })

  it('lazy 且未相交：不发起请求、20s 后仍是 fallback 且断路器保持 healthy；相交后才发请求', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      process.env[BREAKER_FLAG] = '1'
      let observerCallback: IntersectionObserverCallback | null = null
      const observe = vi.fn()
      class MockIntersectionObserver {
        constructor(cb: IntersectionObserverCallback) {
          observerCallback = cb
        }
        observe = observe
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
      vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

      const requestStart = vi.fn((input: { requestedCandidateUrl: string; candidateIndex: number }) => ({
        requestUrl: input.requestedCandidateUrl,
        requestId: `req-${input.candidateIndex}`,
      }))

      const { container } = render(
        <ResilientMapImage
          src="https://image.anitabi.cn/points/217249/gated.jpg?w=640&q=80"
          alt="gated"
          kind="point"
          diagnosticSurface="map"
          diagnosticSlotKey="gated"
          onDiagnosticRequestStart={requestStart}
          fallback={<div>fallback</div>}
        />,
      )

      // 未相交：fallback + 零尺寸哨兵，不 acquire lease、不发请求
      expect(screen.getByText('fallback')).toBeInTheDocument()
      expect(screen.queryByAltText('gated')).not.toBeInTheDocument()
      expect(container.querySelector('[data-map-image-sentinel]')).not.toBeNull()
      expect(observe).toHaveBeenCalledTimes(1)

      // 视口外的图浏览器根本不发请求：20s 后也不应被记成"超时失败"
      await advanceTimers(20001)
      expect(requestStart).not.toHaveBeenCalled()
      expect(screen.queryByAltText('gated')).not.toBeInTheDocument()
      expect(screen.getByText('fallback')).toBeInTheDocument()
      expect(resolveHostState('image.anitabi.cn', 'point', Date.now())).toBe('healthy')

      // 相交后走正常请求链
      await act(async () => {
        observerCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
        await Promise.resolve()
        await Promise.resolve()
      })
      await flushMicrotasks()
      expect(requestStart).toHaveBeenCalledTimes(1)
      expect(screen.getByAltText('gated')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('连续 timeout 不计入断路器：三次超时后 host 仍 healthy', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      process.env[BREAKER_FLAG] = '1'

      render(
        <ResilientMapImage
          src="https://www.anitabi.cn/bangumi/290980.jpg"
          alt="timeout-cover"
          kind="cover"
          fallback={<div>fallback</div>}
        />,
      )

      await flushMicrotasks()
      expect((screen.getByAltText('timeout-cover') as HTMLImageElement).src).toBe(
        'https://img-tc.anitabi.cn/bangumi/290980.jpg',
      )

      // 直连 4s 超时 → 第二档；再 4s → 代理档；代理 6s → 代理 retry 档，全程不应记断路器
      await advanceTimers(4001)
      await flushMicrotasks()
      await advanceTimers(4001)
      await flushMicrotasks()
      await advanceTimers(6001)
      await flushMicrotasks()

      expect(resolveHostState('img-tc.anitabi.cn', 'cover', Date.now())).toBe('healthy')
      expect(resolveHostState('image.anitabi.cn', 'cover', Date.now())).toBe('healthy')
      // 三次超时后仍在重试链上（代理 retry），没有秒进 fallback
      expect(screen.queryByText('fallback')).not.toBeInTheDocument()
      expect((screen.getByAltText('timeout-cover') as HTMLImageElement).src).toContain('_retry=1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('真实网络错误（onError）才计入断路器：同一 host 累计 3 次 error 后 degraded', async () => {
    process.env[BREAKER_FLAG] = '1'

    // 第一条链：直连 + 直连 retry 两次 error（候选梯第 3 档是代理，其 error 会记入上游 host）
    const first = render(
      <ResilientMapImage
        src="https://www.anitabi.cn/bangumi/405785.jpg"
        alt="error-cover"
        kind="cover"
        fallback={<div>fallback</div>}
      />,
    )

    const firstDirect = await screen.findByAltText('error-cover') as HTMLImageElement
    expect(firstDirect.src).toBe('https://img-tc.anitabi.cn/bangumi/405785.jpg')
    fireEvent.error(firstDirect)

    const firstRetry = await screen.findByAltText('error-cover') as HTMLImageElement
    expect(firstRetry.src).toContain('_retry=1')
    fireEvent.error(firstRetry)

    // 阈值 2→3：两次 error 后仍 healthy，代理上游 host 未被记数
    expect(resolveHostState('img-tc.anitabi.cn', 'cover', Date.now())).toBe('healthy')
    expect(resolveHostState('image.anitabi.cn', 'cover', Date.now())).toBe('healthy')
    first.unmount()

    // 第二条链：同一投递 host 第 3 次 error → degraded
    render(
      <ResilientMapImage
        src="https://www.anitabi.cn/bangumi/405785.jpg"
        alt="error-cover"
        kind="cover"
        fallback={<div>fallback</div>}
      />,
    )
    const secondDirect = await screen.findByAltText('error-cover') as HTMLImageElement
    expect(secondDirect.src).toBe('https://img-tc.anitabi.cn/bangumi/405785.jpg')
    fireEvent.error(secondDirect)

    expect(resolveHostState('img-tc.anitabi.cn', 'cover', Date.now())).toBe('degraded')
  })

  it('blocked host 不再 0ms 秒失败：受阻候选被跳过，最后一档用降级预算正常尝试一次', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      process.env[BREAKER_FLAG] = '1'
      // blocked 阈值 3→6（10s 滑窗）：两个 host 各记 6 次
      for (const at of [0, 1, 2, 3, 4, 5]) {
        recordHostFailure('image.anitabi.cn', 'cover', at)
        recordHostFailure('img-tc.anitabi.cn', 'cover', at)
      }
      expect(resolveHostState('img-tc.anitabi.cn', 'cover', 6)).toBe('blocked')

      render(
        <ResilientMapImage
          src="https://www.anitabi.cn/bangumi/513345.jpg"
          alt="blocked-cover"
          kind="cover"
          fallback={<div>fallback</div>}
        />,
      )

      await flushMicrotasks()
      // 前两个候选（blocked）被跳过，最后一档直连 retry 仍正常发出请求渲染 img
      const img = screen.getByAltText('blocked-cover') as HTMLImageElement
      expect(img.src).toBe('https://img-tc.anitabi.cn/bangumi/513345.jpg?_retry=1')

      // 降级预算 2s：预算内不超时、不秒失败
      await advanceTimers(1999)
      expect(screen.getByAltText('blocked-cover')).toBeInTheDocument()
      expect(screen.queryByText('fallback')).not.toBeInTheDocument()

      await advanceTimers(2)
      await flushMicrotasks()
      expect(screen.getByText('fallback')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('首次 onLoad 后卸载再挂载同 src：命中已加载缓存，立即渲染 img、不经过 lease', async () => {
    const src = 'https://image.anitabi.cn/points/217249/cached.jpg?w=640&q=80'
    const first = render(
      <ResilientMapImage src={src} alt="cached" kind="point" fallback={<div>fallback</div>} />,
    )
    const img = await screen.findByAltText('cached')
    fireEvent.load(img)
    first.unmount()

    // 唯一的调度槽被占住：若走正常请求链，拿不到 lease 就渲染不出 img
    resetMapImageRequestSchedulerForTest({
      maxActive: 1,
      laneStartThresholds: {
        'interaction-critical': 1,
        'viewport-thumbnail': 1,
        'viewport-visible': 1,
        'warmup-first-view': 1,
        warmup: 1,
      },
    })
    const blockingLease = await acquireMapImageRequestSlot({ lane: 'viewport-visible' })
    try {
      render(
        <ResilientMapImage src={src} alt="cached" kind="point" fallback={<div>fallback</div>} />,
      )
      // 同步即可查询到 alt：跳过视口门控、lease 与计时器
      expect(screen.getByAltText('cached')).toBeInTheDocument()
    } finally {
      blockingLease.release()
    }
  })

  it('fallbackSrc 追加为候选梯最后一档：两档代理都 error 后启用，再 error 才回退占位', async () => {
    const fallbackSrc = '/api/google/point-photo?pointId=115908%3Auji&maxwidth=400'
    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/fb.jpg?w=640&q=80"
        alt="with-fallback"
        kind="point"
        fallbackSrc={fallbackSrc}
        fallback={<div>fallback</div>}
      />,
    )

    const first = await screen.findByAltText('with-fallback') as HTMLImageElement
    expect(decodeURIComponent(first.src)).toContain('/api/anitabi/image-render')
    expect(first.src).not.toContain('point-photo')

    fireEvent.error(first)
    const second = await screen.findByAltText('with-fallback') as HTMLImageElement
    expect(decodeURIComponent(second.src)).toContain('_retry=1')
    expect(second.src).not.toContain('point-photo')

    // 两档代理都 error → 候选梯最后一档 fallbackSrc（point-photo 兜底）
    fireEvent.error(second)
    const third = await screen.findByAltText('with-fallback') as HTMLImageElement
    expect(third.src).toContain('/api/google/point-photo')
    expect(third.src).toContain('pointId=115908%3Auji')

    // point-photo 同属代理 URL：先 _retry 一次，再 error 才落到占位节点
    fireEvent.error(third)
    const fourth = await screen.findByAltText('with-fallback') as HTMLImageElement
    expect(fourth.src).toContain('/api/google/point-photo')
    expect(fourth.src).toContain('_retry=1')

    fireEvent.error(fourth)
    expect(screen.getByText('fallback')).toBeInTheDocument()
  })

  it('src 已是 point-photo 兜底 URL 时不再重复追加同一条候选', async () => {
    const src = '/api/google/point-photo?pointId=115908%3Auji&maxwidth=400'
    render(
      <ResilientMapImage
        src={src}
        alt="self-fallback"
        kind="point"
        fallbackSrc={src}
        fallback={<div>fallback</div>}
      />,
    )

    const img = await screen.findByAltText('self-fallback') as HTMLImageElement
    expect(img.src).toContain('/api/google/point-photo')
    // 去重后只有一档：error 后进入代理 retry（_retry=1）而不是重复同一 URL
    fireEvent.error(img)
    const retried = await screen.findByAltText('self-fallback') as HTMLImageElement
    expect(retried.src).toContain('_retry=1')
  })
})
