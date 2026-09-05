import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 只 mock 调度器：persisted 命中必须仍走 lease 申请（M6），用调用次数观测
const schedulerMock = vi.hoisted(() => ({
  acquireTimedMapImageRequestSlot: vi.fn(async () => ({ lease: { release: vi.fn() }, queueWaitMs: 0 })),
}))
vi.mock('@/features/map/anitabi/mapImageRequestScheduler', () => schedulerMock)

const STORAGE_KEY = 'seichigo:mapImageLoaded:v1'
// 同源 URL：候选梯原样放行（绝对化后即为候选本身），persisted key 才能与候选匹配
const PERSISTED_SRC = '/api/google/place-photo?ref=persisted-only'
const PERSISTED_ABSOLUTE = 'http://localhost:3000/api/google/place-photo?ref=persisted-only'

beforeEach(() => {
  window.sessionStorage.clear()
  schedulerMock.acquireTimedMapImageRequestSlot.mockClear()
})

afterEach(() => {
  window.sessionStorage.clear()
})

describe('ResilientMapImage persisted 命中（M6：上个会话水合、本会话未验证）', () => {
  it('persisted 命中不走"已验证直渲"：仍申请 lease 一次；onload 后升级为已验证', async () => {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([PERSISTED_ABSOLUTE]))
    vi.resetModules()
    const cache = await import('@/components/map/utils/mapImageLoadedCache')
    expect(cache.hasPersistedMapImage(PERSISTED_SRC)).toBe(true)
    expect(cache.hasLoadedMapImage(PERSISTED_SRC)).toBe(false)
    const { default: ResilientMapImage } = await import('@/components/map/ResilientMapImage')

    render(<ResilientMapImage src={PERSISTED_SRC} alt="persisted" kind="default" />)
    const img = await screen.findByAltText('persisted')
    // 仍然过调度器（lease 申请一次），而不是缓存命中直渲
    expect(schedulerMock.acquireTimedMapImageRequestSlot).toHaveBeenCalledTimes(1)
    expect(img.getAttribute('src')).toContain(PERSISTED_SRC)

    fireEvent.load(img)
    // onload 验证后升级为已加载（本会话）
    expect(cache.hasLoadedMapImage(PERSISTED_SRC)).toBe(true)
  })

  it('对照：已验证命中不申请 lease（直渲行为不变）', async () => {
    vi.resetModules()
    const cache = await import('@/components/map/utils/mapImageLoadedCache')
    cache.rememberLoadedMapImage(PERSISTED_SRC)
    const { default: ResilientMapImage } = await import('@/components/map/ResilientMapImage')

    render(<ResilientMapImage src={PERSISTED_SRC} alt="verified" kind="default" />)
    await screen.findByAltText('verified')
    expect(schedulerMock.acquireTimedMapImageRequestSlot).not.toHaveBeenCalled()
  })
})
