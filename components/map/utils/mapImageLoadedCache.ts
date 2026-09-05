/**
 * 已成功加载过的地图图片 URL 记忆（模块级，跨组件实例共享）。
 * 用途：轮询/重挂载后，同一位置同一 URL 的图片不再走 视口门控 → lease →
 * 计时器 的完整请求链，直接用命中 URL 渲染，避免"图已显示又闪回占位"。
 * 键归一化：去掉 `_retry` 参数（同一图片的重试档视为同一图）。
 * 容量有界：最多 500 条，超出逐出最旧（插入序）。
 * 跨刷新持久化：水合自/去抖写回 sessionStorage['seichigo:mapImageLoaded:v1']
 * （JSON 字符串数组，归一化后的 URL，插入序）；无 window/解析失败/超配额一律静默。
 */

const MAX_LOADED_MAP_IMAGE_ENTRIES = 500
const LOADED_MAP_IMAGE_STORAGE_KEY = 'seichigo:mapImageLoaded:v1'
const PERSIST_DEBOUNCE_MS = 500
// L11：写回优先走 requestIdleCallback（带 1000ms 超时兜底），没有才退 setTimeout
const PERSIST_IDLE_TIMEOUT_MS = 1000

type IdleCapableWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

function idleCapableWindow(): IdleCapableWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as IdleCapableWindow)
}

function normalizeLoadedMapImageKey(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const parsed = new URL(raw, baseOrigin)
    parsed.searchParams.delete('_retry')
    return parsed.toString()
  } catch {
    return raw
  }
}

function readPersistedLoadedMapImages(): string[] {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return []
    const raw = window.sessionStorage.getItem(LOADED_MAP_IMAGE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is string => typeof value === 'string' && Boolean(value))
      .slice(-MAX_LOADED_MAP_IMAGE_ENTRIES)
  } catch {
    return []
  }
}

const loadedMapImageUrls = new Map<string, true>()
// M6：水合自 sessionStorage 的条目是 persisted——上个会话加载过，但本会话尚未
// 经 onload 验证；hasLoadedMapImage 只认本会话验证过的，persisted 命中仍须走
// 调度器（lease+计时器）验证一次（ResilientMapImage），验证后 remember 升级为已加载
const persistedMapImageUrls = new Map<string, true>()
for (const url of readPersistedLoadedMapImages()) {
  const key = normalizeLoadedMapImageKey(url)
  if (key) persistedMapImageUrls.set(key, true)
}

let persistTimer: { kind: 'idle'; handle: number } | { kind: 'timeout'; handle: ReturnType<typeof setTimeout> } | null = null

function persistLoadedMapImagesNow(): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return
    window.sessionStorage.setItem(
      LOADED_MAP_IMAGE_STORAGE_KEY,
      JSON.stringify([...loadedMapImageUrls.keys()]),
    )
  } catch {
    // 超配额/隐私模式写失败：静默，内存行为不受影响
  }
}

function cancelPersistTimer(): void {
  if (persistTimer == null) return
  if (persistTimer.kind === 'idle') {
    idleCapableWindow()?.cancelIdleCallback?.(persistTimer.handle)
  } else {
    clearTimeout(persistTimer.handle)
  }
  persistTimer = null
}

function schedulePersistLoadedMapImages(): void {
  if (persistTimer != null) return
  const idleWindow = idleCapableWindow()
  if (typeof idleWindow?.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(
      () => {
        persistTimer = null
        persistLoadedMapImagesNow()
      },
      { timeout: PERSIST_IDLE_TIMEOUT_MS },
    )
    persistTimer = { kind: 'idle', handle }
    return
  }
  persistTimer = {
    kind: 'timeout',
    handle: setTimeout(() => {
      persistTimer = null
      persistLoadedMapImagesNow()
    }, PERSIST_DEBOUNCE_MS),
  }
}

export function rememberLoadedMapImage(url: string): void {
  const key = normalizeLoadedMapImageKey(url)
  if (!key) return
  // 重新插入以刷新新旧顺序（命中过的 URL 不该被提前逐出）
  if (loadedMapImageUrls.has(key)) loadedMapImageUrls.delete(key)
  loadedMapImageUrls.set(key, true)
  if (loadedMapImageUrls.size > MAX_LOADED_MAP_IMAGE_ENTRIES) {
    const oldest = loadedMapImageUrls.keys().next().value
    if (oldest) loadedMapImageUrls.delete(oldest)
  }
  schedulePersistLoadedMapImages()
}

export function hasLoadedMapImage(url: string): boolean {
  const key = normalizeLoadedMapImageKey(url)
  return key ? loadedMapImageUrls.has(key) : false
}

/** M6：上个会话持久化水合、本会话尚未 onload 验证的条目（命中后仍须走调度器验证一次） */
export function hasPersistedMapImage(url: string): boolean {
  const key = normalizeLoadedMapImageKey(url)
  return key ? persistedMapImageUrls.has(key) : false
}

/**
 * 忘掉一张图：缓存命中直渲的 URL 仍 onError（浏览器缓存已被逐出且上游失败）时调用，
 * 避免后续渲染反复走"假命中"。persisted 条目验证失败同样忘掉（M6）。
 */
export function forgetLoadedMapImage(url: string): void {
  const key = normalizeLoadedMapImageKey(url)
  if (!key) return
  const removed = loadedMapImageUrls.delete(key) || persistedMapImageUrls.delete(key)
  if (removed) schedulePersistLoadedMapImages()
}

export function resetLoadedMapImageCacheForTest(): void {
  loadedMapImageUrls.clear()
  persistedMapImageUrls.clear()
  cancelPersistTimer()
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(LOADED_MAP_IMAGE_STORAGE_KEY)
    }
  } catch {
    // 静默
  }
}
