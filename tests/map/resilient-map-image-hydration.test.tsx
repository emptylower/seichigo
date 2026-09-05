import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import { resetLoadedMapImageCacheForTest } from '@/components/map/utils/mapImageLoadedCache'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

// 模拟真实浏览器：存在 IntersectionObserver，但哨兵未相交（不触发回调）
class IdleIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ResilientMapImage 水合一致性（lazy 视口门控）', () => {
  beforeEach(() => {
    resetDegradedMapImageHostsForTest()
    resetLoadedMapImageCacheForTest()
    resetMapImageRequestSchedulerForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lazy 首帧在服务端与客户端一致：水合不产生 Hydration 报错', async () => {
    // 服务端环境：无 IntersectionObserver
    vi.stubGlobal('IntersectionObserver', undefined)
    const element = (
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/hydration.jpg?w=640&q=80"
        alt="hydration"
        kind="point"
        loading="lazy"
        fallback={<div>fallback</div>}
      />
    )
    const serverHtml = renderToString(element)

    // 浏览器环境：有 IntersectionObserver，哨兵尚未相交
    vi.stubGlobal('IntersectionObserver', IdleIntersectionObserver)
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = serverHtml

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const actEnvironmentFlag = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousActEnvironment = actEnvironmentFlag.IS_REACT_ACT_ENVIRONMENT
    actEnvironmentFlag.IS_REACT_ACT_ENVIRONMENT = true
    let root: ReturnType<typeof hydrateRoot> | null = null
    try {
      await act(async () => {
        root = hydrateRoot(container, element)
      })
      const hydrationErrors = consoleError.mock.calls.filter((call) => /hydrat/i.test(String(call[0])))
      expect(hydrationErrors).toEqual([])
    } finally {
      await act(async () => {
        root?.unmount()
      })
      container.remove()
      consoleError.mockRestore()
      actEnvironmentFlag.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })

  it('无 IntersectionObserver 环境挂载后进入在视口状态并发起请求（既有行为）', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    render(
      <ResilientMapImage
        src="https://image.anitabi.cn/points/217249/no-io.jpg?w=640&q=80"
        alt="no-io"
        kind="point"
        loading="lazy"
        fallback={<div>fallback</div>}
      />,
    )

    const img = await screen.findByAltText('no-io')
    expect(img.getAttribute('src')).toBeTruthy()
  })
})
