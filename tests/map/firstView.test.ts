import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FIRST_VIEW_DESKTOP_SLOT_COUNT,
  FIRST_VIEW_MOBILE_SLOT_COUNT,
  beginFirstViewSession,
  createFirstViewSlotKey,
  getFirstViewTrackedSlotCount,
  markFirstViewAnchor,
  markFirstViewRequestStart,
  markFirstViewSettlement,
  prioritizeFirstViewItems,
  readFirstViewDebugStore,
  resetFirstViewDebugStore,
} from '@/features/map/anitabi/firstView'

describe('map first-view helpers', () => {
  beforeEach(() => {
    resetFirstViewDebugStore()
  })

  afterEach(() => {
    resetFirstViewDebugStore()
  })

  it('uses desktop and mobile tracked slot counts', () => {
    expect(getFirstViewTrackedSlotCount(1440)).toBe(FIRST_VIEW_DESKTOP_SLOT_COUNT)
    expect(getFirstViewTrackedSlotCount(390)).toBe(FIRST_VIEW_MOBILE_SLOT_COUNT)
  })

  it('prioritizes the tracked first-view slice before overflow items', () => {
    const ordered = prioritizeFirstViewItems(['a', 'b', 'c', 'd'], 390)

    expect(ordered.tracked).toEqual(['a', 'b', 'c', 'd'])
    expect(ordered.overflow).toEqual([])
    expect(ordered.ordered).toEqual(['a', 'b', 'c', 'd'])

    const desktopOrdered = prioritizeFirstViewItems(Array.from({ length: 24 }, (_, index) => `slot-${index + 1}`), 1440)
    expect(desktopOrdered.tracked).toHaveLength(FIRST_VIEW_DESKTOP_SLOT_COUNT)
    expect(desktopOrdered.overflow).toHaveLength(4)
    expect(desktopOrdered.ordered[0]).toBe('slot-1')
    expect(desktopOrdered.ordered.at(-1)).toBe('slot-24')
  })

  it('records anchors, request starts, and settlements idempotently', () => {
    const metricRef = { current: {} as Record<string, string | number> }
    beginFirstViewSession(metricRef, 'test-session', 1)
    const slotKey = createFirstViewSlotKey('thumb', 'p001')

    const shellReady = markFirstViewAnchor(metricRef, 'map_shell_ready', 10)
    const bootstrapReady = markFirstViewAnchor(metricRef, 'bootstrap_ready', 20)
    const firstRequest = markFirstViewRequestStart(metricRef, {
      slotKey,
      slotType: 'point-thumbnail',
      src: 'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
      owner: 'viewport-loader',
      atMs: 30,
    })
    const settled = markFirstViewSettlement(metricRef, {
      slotKey,
      slotType: 'point-thumbnail',
      src: 'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
      owner: 'viewport-loader',
      state: 'visible',
      atMs: 45,
    })

    expect(shellReady).toBe(10)
    expect(bootstrapReady).toBe(20)
    expect(firstRequest).toBe(30)
    expect(settled).toBe(45)

    // second writes are ignored
    expect(markFirstViewAnchor(metricRef, 'map_shell_ready', 999)).toBe(10)
    expect(markFirstViewRequestStart(metricRef, {
      slotKey,
      slotType: 'point-thumbnail',
      src: 'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
      owner: 'viewport-loader',
      atMs: 999,
    })).toBe(30)
    expect(markFirstViewSettlement(metricRef, {
      slotKey,
      slotType: 'point-thumbnail',
      src: 'https://image.anitabi.cn/user/0/a.jpg?plan=h160',
      owner: 'viewport-loader',
      state: 'fallback',
      atMs: 999,
    })).toBe(45)

    const store = readFirstViewDebugStore(metricRef)
    expect(store.anchors.map_shell_ready).toBe(10)
    expect(store.anchors.bootstrap_ready).toBe(20)
    expect(store.slots[slotKey]).toMatchObject({
      requestStartedAt: 30,
      settledAt: 45,
      settledState: 'visible',
      owner: 'viewport-loader',
    })
    expect(metricRef.current.first_view_tracked_request_count).toBe(1)
    expect(metricRef.current.first_view_tracked_settled_count).toBe(1)
    expect(metricRef.current.first_view_tracked_visible_count).toBe(1)
    expect(metricRef.current.first_view_tracked_fallback_count).toBe(0)
  })

  it('starts a fresh runtime session by clearing prior first-view data', () => {
    const metricRef = { current: {} as Record<string, string | number> }
    beginFirstViewSession(metricRef, 'session-a', 10)
    markFirstViewAnchor(metricRef, 'map_shell_ready', 20)
    markFirstViewRequestStart(metricRef, {
      slotKey: createFirstViewSlotKey('cover', 1),
      slotType: 'cover-avatar',
      src: 'https://bgm.tv/pic/cover/l/00/00/1.jpg',
      owner: 'warmup',
      atMs: 30,
    })

    beginFirstViewSession(metricRef, 'session-b', 40)

    expect(readFirstViewDebugStore(metricRef)).toEqual({
      anchors: {},
      slots: {},
    })
    expect(metricRef.current.first_view_session_label).toBe('session-b')
    expect(metricRef.current.first_view_session_started_at_ms).toBe(40)
    expect(metricRef.current.first_view_tracked_request_count).toBeUndefined()
  })

  it('isolates debug stores across concurrent sessions', () => {
    const metricA = { current: {} as Record<string, string | number> }
    const metricB = { current: {} as Record<string, string | number> }

    beginFirstViewSession(metricA, 'session-a', 10)
    beginFirstViewSession(metricB, 'session-b', 11)

    markFirstViewRequestStart(metricA, {
      slotKey: createFirstViewSlotKey('cover', 1),
      slotType: 'cover-avatar',
      src: 'https://bgm.tv/pic/cover/l/00/00/1.jpg',
      owner: 'warmup',
      atMs: 12,
    })
    markFirstViewRequestStart(metricB, {
      slotKey: createFirstViewSlotKey('cover', 2),
      slotType: 'cover-avatar',
      src: 'https://bgm.tv/pic/cover/l/00/00/2.jpg',
      owner: 'viewport-loader',
      atMs: 13,
    })

    expect(readFirstViewDebugStore(metricA).slots).toHaveProperty('cover-1')
    expect(readFirstViewDebugStore(metricA).slots).not.toHaveProperty('cover-2')
    expect(readFirstViewDebugStore(metricB).slots).toHaveProperty('cover-2')
    expect(readFirstViewDebugStore(metricB).slots).not.toHaveProperty('cover-1')
    expect(metricA.current.first_view_session_id).not.toBe(metricB.current.first_view_session_id)
  })
})
