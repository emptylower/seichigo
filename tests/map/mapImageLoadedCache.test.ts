import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const STORAGE_KEY = 'seichigo:mapImageLoaded:v1'
const MODULE = '@/components/map/utils/mapImageLoadedCache'

type FakeStorage = ReturnType<typeof makeSessionStorage>

function makeSessionStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value))
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    read: (key: string) => data.get(key),
    size: () => data.size,
  }
}

function stubWindow(storage: FakeStorage) {
  vi.stubGlobal('window', {
    location: { origin: 'https://seichigo.com' },
    sessionStorage: storage,
  })
}

async function importFresh() {
  return import(MODULE)
}

function readStoredUrls(storage: FakeStorage): string[] {
  const raw = storage.read(STORAGE_KEY)
  if (!raw) return []
  return JSON.parse(raw) as string[]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mapImageLoadedCache sessionStorage 持久化', () => {
  it('remember 写回存储（去 _retry 归一化）；重新 import 后水合为 persisted（M6：本会话未验证）', async () => {
    const storage = makeSessionStorage()
    stubWindow(storage)
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/anitabi/image-render?src=a&_retry=2')
    vi.advanceTimersByTime(600)
    const stored = readStoredUrls(storage)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toBe('https://seichigo.com/api/anitabi/image-render?src=a')

    vi.resetModules()
    const reimported = await importFresh()
    // M6：水合条目是 persisted（上个会话加载过、本会话尚未 onload 验证）——
    // hasLoaded 只对本会话验证过的返回 true
    expect(reimported.hasLoadedMapImage('/api/anitabi/image-render?src=a')).toBe(false)
    expect(reimported.hasLoadedMapImage('/api/anitabi/image-render?src=a&_retry=5')).toBe(false)
    expect(reimported.hasPersistedMapImage('/api/anitabi/image-render?src=a')).toBe(true)
    expect(reimported.hasPersistedMapImage('/api/anitabi/image-render?src=a&_retry=5')).toBe(true)
  })

  it('M6：persisted 条目 remember（onload 验证）后 hasLoaded/hasPersisted 都为 true', async () => {
    const storage = makeSessionStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(['https://seichigo.com/api/img?ref=p']))
    stubWindow(storage)
    const mod = await importFresh()
    expect(mod.hasPersistedMapImage('/api/img?ref=p')).toBe(true)
    expect(mod.hasLoadedMapImage('/api/img?ref=p')).toBe(false)

    mod.rememberLoadedMapImage('/api/img?ref=p')
    expect(mod.hasLoadedMapImage('/api/img?ref=p')).toBe(true)
    expect(mod.hasPersistedMapImage('/api/img?ref=p')).toBe(true)
  })

  it('M6：forget 同时移除已验证与 persisted 条目', async () => {
    const storage = makeSessionStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(['https://seichigo.com/api/img?ref=old']))
    stubWindow(storage)
    const mod = await importFresh()
    expect(mod.hasPersistedMapImage('/api/img?ref=old')).toBe(true)

    mod.forgetLoadedMapImage('/api/img?ref=old')
    expect(mod.hasPersistedMapImage('/api/img?ref=old')).toBe(false)
    expect(mod.hasLoadedMapImage('/api/img?ref=old')).toBe(false)
  })

  it('超过 500 条逐出最旧，存储与内存同步', async () => {
    const storage = makeSessionStorage()
    stubWindow(storage)
    const mod = await importFresh()
    for (let i = 0; i < 505; i++) mod.rememberLoadedMapImage(`/api/img?ref=${i}`)
    vi.advanceTimersByTime(600)
    expect(mod.hasLoadedMapImage('/api/img?ref=0')).toBe(false)
    expect(mod.hasLoadedMapImage('/api/img?ref=4')).toBe(false)
    expect(mod.hasLoadedMapImage('/api/img?ref=5')).toBe(true)
    expect(mod.hasLoadedMapImage('/api/img?ref=504')).toBe(true)
    const stored = readStoredUrls(storage)
    expect(stored).toHaveLength(500)
    expect(stored[0]).toBe('https://seichigo.com/api/img?ref=5')
    expect(stored[stored.length - 1]).toBe('https://seichigo.com/api/img?ref=504')
  })

  it('forget 后不命中，且写回后存储同步移除', async () => {
    const storage = makeSessionStorage()
    stubWindow(storage)
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/img?ref=gone')
    mod.rememberLoadedMapImage('/api/img?ref=keep')
    vi.advanceTimersByTime(600)
    expect(mod.hasLoadedMapImage('/api/img?ref=gone')).toBe(true)

    mod.forgetLoadedMapImage('/api/img?ref=gone')
    expect(mod.hasLoadedMapImage('/api/img?ref=gone')).toBe(false)
    expect(mod.hasLoadedMapImage('/api/img?ref=keep')).toBe(true)
    vi.advanceTimersByTime(600)
    expect(readStoredUrls(storage)).toEqual(['https://seichigo.com/api/img?ref=keep'])
  })

  it('resetLoadedMapImageCacheForTest 同时清空存储', async () => {
    const storage = makeSessionStorage()
    stubWindow(storage)
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/img?ref=x')
    vi.advanceTimersByTime(600)
    expect(readStoredUrls(storage)).toHaveLength(1)

    mod.resetLoadedMapImageCacheForTest()
    expect(mod.hasLoadedMapImage('/api/img?ref=x')).toBe(false)
    expect(readStoredUrls(storage)).toHaveLength(0)
  })

  it('sessionStorage 读写抛错时不影响内存行为', async () => {
    const storage = makeSessionStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    stubWindow(storage)
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/img?ref=mem')
    vi.advanceTimersByTime(600)
    expect(mod.hasLoadedMapImage('/api/img?ref=mem')).toBe(true)

    // 水合读取抛错 → 视为空，不抛错
    vi.resetModules()
    storage.getItem = () => {
      throw new Error('SecurityError')
    }
    const reimported = await importFresh()
    expect(reimported.hasLoadedMapImage('/api/img?ref=mem')).toBe(false)
    reimported.rememberLoadedMapImage('/api/img?ref=still-works')
    expect(reimported.hasLoadedMapImage('/api/img?ref=still-works')).toBe(true)
  })

  it('无 window（SSR）时静默降级为纯内存', async () => {
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/img?ref=ssr')
    vi.advanceTimersByTime(600)
    expect(mod.hasLoadedMapImage('/api/img?ref=ssr')).toBe(true)
  })

  it('L11：有 requestIdleCallback 时用 idle 回调（timeout 1000）写回，触发前不落盘', async () => {
    const storage = makeSessionStorage()
    const idleCallbacks = new Map<number, () => void>()
    let nextHandle = 0
    const requestIdleCallback = vi.fn((cb: () => void, _options?: { timeout: number }) => {
      nextHandle += 1
      idleCallbacks.set(nextHandle, cb)
      return nextHandle
    })
    stubWindow(storage)
    vi.stubGlobal('window', {
      location: { origin: 'https://seichigo.com' },
      sessionStorage: storage,
      requestIdleCallback,
    })
    const mod = await importFresh()
    mod.rememberLoadedMapImage('/api/img?ref=idle')
    expect(requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(requestIdleCallback.mock.calls[0]?.[1]).toEqual({ timeout: 1000 })
    // idle 回调触发前不写存储；setTimeout 路径不被使用
    vi.advanceTimersByTime(600)
    expect(readStoredUrls(storage)).toEqual([])

    idleCallbacks.get(1)!()
    expect(readStoredUrls(storage)).toEqual(['https://seichigo.com/api/img?ref=idle'])
  })
})
