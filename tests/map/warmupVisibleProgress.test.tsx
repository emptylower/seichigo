import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'
import { useMemo, useRef, useState } from 'react'
import type {
  WarmupMetrics,
  WarmupProgress,
  WarmupTaskProgress,
} from '@/features/map/anitabi/shared'

// shared.ts 顶层引入了 maplibre-gl，jsdom 下需要 createObjectURL 兜底（与 useAnitabiDerivedState.test.tsx 同款 shim）。
let computeWeightedWarmupPercent: typeof import('@/features/map/anitabi/shared').computeWeightedWarmupPercent
let WARMUP_TASK_WEIGHTS: typeof import('@/features/map/anitabi/shared').WARMUP_TASK_WEIGHTS
let WARMUP_VISIBLE_TASK_WEIGHTS: typeof import('@/features/map/anitabi/shared').WARMUP_VISIBLE_TASK_WEIGHTS
let createEmptyWarmupTaskProgress: typeof import('@/features/map/anitabi/shared').createEmptyWarmupTaskProgress
let useWarmupProgressState: typeof import('@/features/map/anitabi/useWarmupProgressState').useWarmupProgressState
let MapLoadingProgress: typeof import('@/components/map/MapLoadingProgress').default

beforeAll(async () => {
  if (typeof window !== 'undefined' && typeof window.URL.createObjectURL !== 'function') {
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:maplibre-worker'),
      configurable: true,
    })
  }
  const shared = await import('@/features/map/anitabi/shared')
  computeWeightedWarmupPercent = shared.computeWeightedWarmupPercent
  WARMUP_TASK_WEIGHTS = shared.WARMUP_TASK_WEIGHTS
  WARMUP_VISIBLE_TASK_WEIGHTS = shared.WARMUP_VISIBLE_TASK_WEIGHTS
  createEmptyWarmupTaskProgress = shared.createEmptyWarmupTaskProgress
  ;({ useWarmupProgressState } = await import('@/features/map/anitabi/useWarmupProgressState'))
  MapLoadingProgress = (await import('@/components/map/MapLoadingProgress')).default
})

const label = {
  preloadTitle: '地图预加载',
  preloadMapDone: '地图就绪',
} as any

function makeTasks(map: number, cards: number, details: number, images: number): WarmupTaskProgress {
  return {
    map: { percent: map, detail: '' },
    cards: { percent: cards, detail: '' },
    details: { percent: details, detail: '' },
    images: { percent: images, detail: '' },
  }
}

// 与 useAnitabiMapController 完全一致：内部 warmupProgress 保持四任务模型，
// 传给布局（进度卡片）的 warmupVisibleProgress 只换 percent 为 map+cards 可见口径。
function useWarmupHarness() {
  const [warmupProgress, setWarmupProgress] = useState<WarmupProgress>({
    phase: 'idle',
    percent: 0,
    title: label.preloadTitle,
    detail: '',
  })
  const [warmupTaskProgress, setWarmupTaskProgress] = useState<WarmupTaskProgress>(() => createEmptyWarmupTaskProgress())
  const warmupBlockingUiRef = useRef(true)
  const warmupMetricRef = useRef<WarmupMetrics>({})
  const warmupRunTokenRef = useRef(0)
  const api = useWarmupProgressState({
    label,
    setWarmupProgress,
    setWarmupTaskProgress,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  })
  const warmupVisiblePercent = computeWeightedWarmupPercent(warmupTaskProgress, WARMUP_VISIBLE_TASK_WEIGHTS)
  const warmupVisibleProgress = useMemo(
    () => (warmupVisiblePercent === warmupProgress.percent
      ? warmupProgress
      : { ...warmupProgress, percent: warmupVisiblePercent }),
    [warmupProgress, warmupVisiblePercent],
  )
  return {
    ...api,
    warmupProgress,
    warmupTaskProgress,
    warmupVisibleProgress,
    warmupBlockingUiRef,
    warmupMetricRef,
    warmupRunTokenRef,
  }
}

describe('computeWeightedWarmupPercent', () => {
  it('可见口径只统计 map+cards：两者全 100 即返回 100，无视 details/images', () => {
    const tasks = makeTasks(100, 100, 40, 10)
    expect(computeWeightedWarmupPercent(tasks, WARMUP_VISIBLE_TASK_WEIGHTS)).toBe(100)
  })

  it('四任务口径保持旧模型：details/images 未完成后仍按权重聚合', () => {
    const tasks = makeTasks(100, 100, 40, 10)
    // (20*100 + 30*100 + 35*40 + 20*10) / 105 = 62.85… → 62（权重总和为 105）
    expect(computeWeightedWarmupPercent(tasks, WARMUP_TASK_WEIGHTS)).toBe(62)
  })

  it('可见口径在中间态按 map+cards 权重归一化并向下取整', () => {
    const tasks = makeTasks(100, 50, 0, 0)
    // (20*100 + 30*50) / 50 = 70
    expect(computeWeightedWarmupPercent(tasks, WARMUP_VISIBLE_TASK_WEIGHTS)).toBe(70)
  })

  it('被统计任务未全部完成时不允许到达 100（钳制在 99）', () => {
    const tasks = makeTasks(100, 99, 100, 100)
    expect(computeWeightedWarmupPercent(tasks, WARMUP_VISIBLE_TASK_WEIGHTS)).toBe(99)
  })

  it('空权重集合返回 0', () => {
    expect(computeWeightedWarmupPercent(makeTasks(100, 100, 100, 100), {})).toBe(0)
  })
})

describe('可见进度与内部四任务指标拆分', () => {
  it('map+cards 达 100 而 details/images 仍在进行时：可见进度为 100，内部口径仍按四任务记录', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupProgress({ phase: 'loading', percent: 0, detail: '' })
    })
    act(() => {
      result.current.updateWarmupTask('map', { percent: 100, detail: '地图就绪' })
    })
    act(() => {
      result.current.updateWarmupTask('cards', { percent: 100, detail: '卡片 (4/4)' })
    })
    act(() => {
      result.current.updateWarmupTask('details', { percent: 40, detail: '点位详情 (2/6)' })
    })
    act(() => {
      result.current.updateWarmupTask('images', { percent: 10, detail: '图片 (12/120)' })
    })

    // 对外可见：地图可用即完成
    expect(result.current.warmupVisibleProgress.percent).toBe(100)
    // 内部 warmupProgress 状态与指标仍是四任务口径：(2000+3000+1400+200)/105 = 62
    expect(result.current.warmupProgress.percent).toBe(62)
    expect(result.current.warmupMetricRef.current.last_progress_percent).toBe(62)
    expect(result.current.warmupMetricRef.current.last_progress_key).toBe('images')
    expect(result.current.warmupMetricRef.current.last_progress_detail).toBe('图片 (12/120)')
  })

  it('details/images 后台推进不影响可见进度，也不会把已完成阶段拉回 loading', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupProgress({ phase: 'loading', percent: 0, detail: '' })
    })
    act(() => {
      result.current.updateWarmupTask('map', { percent: 100, detail: '地图就绪' })
      result.current.updateWarmupTask('cards', { percent: 100, detail: '卡片 (4/4)' })
    })
    expect(result.current.warmupVisibleProgress.percent).toBe(100)

    // 模拟控制器看门狗收尾：phase → idle，blocking 关闭
    act(() => {
      result.current.warmupBlockingUiRef.current = false
    })
    act(() => {
      result.current.updateWarmupProgress({ phase: 'idle' })
    })

    act(() => {
      result.current.updateWarmupTask('details', { percent: 80, detail: '点位详情 (5/6)' })
    })
    act(() => {
      result.current.updateWarmupTask('images', { percent: 60, detail: '图片 (72/120)' })
    })

    expect(result.current.warmupVisibleProgress.percent).toBe(100)
    expect(result.current.warmupProgress.phase).toBe('idle')
    // 内部口径仍在推进：(2000+3000+2800+1200)/105 = 85
    expect(result.current.warmupProgress.percent).toBe(85)
    expect(result.current.warmupMetricRef.current.last_progress_percent).toBe(85)
    expect(result.current.warmupMetricRef.current.last_progress_key).toBe('images')
  })

  it('details/images 推进时内部指标按四任务模型持续更新', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupProgress({ phase: 'loading', percent: 0, detail: '' })
    })
    act(() => {
      result.current.updateWarmupTask('map', { percent: 100, detail: '地图就绪' })
      result.current.updateWarmupTask('cards', { percent: 100, detail: '卡片 (4/4)' })
      result.current.updateWarmupTask('details', { percent: 50, detail: '点位详情 (3/6)' })
    })

    const first = result.current.warmupMetricRef.current
    expect(first.last_progress_key).toBe('details')
    // (2000+3000+1750+0)/105 = 64.28… → 64
    expect(first.last_progress_percent).toBe(64)
    expect(first.last_progress_detail).toBe('点位详情 (3/6)')
    expect(typeof first.last_progress_at).toBe('number')

    act(() => {
      result.current.updateWarmupTask('images', { percent: 30, detail: '图片 (36/120)' })
    })
    const second = result.current.warmupMetricRef.current
    expect(second.last_progress_key).toBe('images')
    // (2000+3000+1750+600)/105 = 70
    expect(second.last_progress_percent).toBe(70)
    expect(second.last_progress_detail).toBe('图片 (36/120)')
  })

  it('回归：单调不回退保护仍生效并计数 progress_regression_blocked', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupTask('map', { percent: 80, detail: '瓦片加载中' })
    })
    act(() => {
      result.current.updateWarmupTask('map', { percent: 50, detail: '回退尝试' })
    })

    expect(result.current.warmupTaskProgress.map.percent).toBe(80)
    expect(result.current.warmupTaskProgress.map.detail).toBe('瓦片加载中')
    expect(result.current.warmupMetricRef.current.progress_regression_blocked).toBe(1)
  })

  it('回归：blocking 期间任务更新会把 idle 阶段推入 loading（旧行为不变）', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupTask('map', { percent: 30, detail: '准备中' })
    })

    expect(result.current.warmupProgress.phase).toBe('loading')
    // 可见口径：(20*30)/50 = 12
    expect(result.current.warmupVisibleProgress.percent).toBe(12)
  })

  it('回归：completeAllWarmupTasks 仍将四个任务全部置为 100', () => {
    const { result } = renderHook(() => useWarmupHarness())

    act(() => {
      result.current.updateWarmupTask('map', { percent: 45, detail: '瓦片加载中' })
    })
    act(() => {
      result.current.completeAllWarmupTasks()
    })

    expect(result.current.warmupTaskProgress.map.percent).toBe(100)
    expect(result.current.warmupTaskProgress.cards.percent).toBe(100)
    expect(result.current.warmupTaskProgress.details.percent).toBe(100)
    expect(result.current.warmupTaskProgress.images.percent).toBe(100)
    expect(result.current.warmupVisibleProgress.percent).toBe(100)
  })
})

describe('MapLoadingProgress 收尾行为（未改动，钉住现有语义）', () => {
  it('visible=false 时不渲染卡片', () => {
    const { container } = render(
      <MapLoadingProgress percent={100} visible={false} title="地图预加载" />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('percent 达 100 且仍可见时按 400ms 收尾动画消失', () => {
    vi.useFakeTimers()
    try {
      const { container, rerender } = render(
        <MapLoadingProgress percent={90} visible={true} title="地图预加载" />,
      )
      expect(container.firstChild).not.toBeNull()

      rerender(<MapLoadingProgress percent={100} visible={true} title="地图预加载" />)
      expect(container.firstChild).not.toBeNull()

      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(container.firstChild).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
