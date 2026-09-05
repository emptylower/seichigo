import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import {
  resetDegradedMapImageHostsForTest,
  resolveHostState,
} from '@/components/map/utils/mapImageHostPolicy'
import { resetLoadedMapImageCacheForTest } from '@/components/map/utils/mapImageLoadedCache'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

/**
 * 第六轮 E3b：从 resilient-map-image.test.tsx 拆出的 point-thumbnail 用例
 * （原文件 788 行超 750 预算）。断言口径同 E2：候选 URL 双重编码，
 * 断言解码后内容需 decodeURIComponent 两次。
 */

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

function decodeTwice(value: string): string {
  return decodeURIComponent(decodeURIComponent(value))
}

describe('ResilientMapImage point-thumbnail', () => {
  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetLoadedMapImageCacheForTest()
    resetMapImageRequestSchedulerForTest()
  })

  afterEach(() => {
    resetDegradedMapImageHostsForTest()
    resetLoadedMapImageCacheForTest()
  })

  it('point-thumbnail 候选梯走代理缩略图变体：解码含 plan=h160、不含 h320', async () => {
    render(
      <>
        <ResilientMapImage
          src="https://image.anitabi.cn/user/0/bangumi/899/points/x.jpg"
          alt="thumb-user"
          kind="point-thumbnail"
          fallback={<div>fallback</div>}
        />
        <ResilientMapImage
          src="https://image.anitabi.cn/points/38125/y.jpg"
          alt="thumb-points"
          kind="point-thumbnail"
          fallback={<div>fallback</div>}
        />
      </>,
    )

    // 用户上传路径（/user/<uid>/bangumi/<id>/points/…）与 /points/ 路径统一 h160
    const userSrc = decodeTwice((await screen.findByAltText('thumb-user') as HTMLImageElement).src)
    expect(userSrc).toContain('/api/anitabi/image-render?url=')
    expect(userSrc).toContain('plan=h160')
    expect(userSrc).not.toContain('plan=h320')

    const pointsSrc = decodeTwice((await screen.findByAltText('thumb-points') as HTMLImageElement).src)
    expect(pointsSrc).toContain('/api/anitabi/image-render?url=')
    expect(pointsSrc).toContain('plan=h160')
    expect(pointsSrc).not.toContain('plan=h320')
  })

  it('point-thumbnail 代理超时预算与 point 相同（20s）', async () => {
    vi.useFakeTimers()
    try {
      render(
        <ResilientMapImage
          src="https://image.anitabi.cn/points/38125/y.jpg"
          alt="thumb-timeout"
          kind="point-thumbnail"
          fallback={<div>fallback</div>}
        />,
      )

      await flushMicrotasks()
      const initial = screen.getByAltText('thumb-timeout') as HTMLImageElement
      expect(decodeTwice(initial.src)).toContain('plan=h160')
      expect(initial.src).not.toContain('_retry=1')

      // 15 秒时仍未超时（缩略图与 point 同档 20s 预算）
      await advanceTimers(15000)
      expect((screen.getByAltText('thumb-timeout') as HTMLImageElement).src).not.toContain('_retry=1')
      expect(screen.queryByText('fallback')).not.toBeInTheDocument()

      await advanceTimers(5001)
      await flushMicrotasks()

      expect((screen.getByAltText('thumb-timeout') as HTMLImageElement).src).toContain('_retry=1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('point-thumbnail 的 onError 计入 point-thumbnail 断路器 scope，不污染 point/default', async () => {
    // 单条挂载链只在候选 1 → 候选 2 时记 1 次网络错误：三条链累计 3 次达到 degraded 阈值
    for (let i = 0; i < 3; i += 1) {
      const view = render(
        <ResilientMapImage
          src="https://image.anitabi.cn/points/38125/scope.jpg"
          alt="thumb-scope"
          kind="point-thumbnail"
          fallback={<div>fallback</div>}
        />,
      )
      const img = await screen.findByAltText('thumb-scope') as HTMLImageElement
      fireEvent.error(img)
      await flushMicrotasks()
      view.unmount()
    }

    expect(resolveHostState('image.anitabi.cn', 'point-thumbnail', Date.now())).toBe('degraded')
    expect(resolveHostState('image.anitabi.cn', 'point', Date.now())).toBe('healthy')
    expect(resolveHostState('image.anitabi.cn', 'default', Date.now())).toBe('healthy')
  })
})
