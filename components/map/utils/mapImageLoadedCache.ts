/**
 * 已成功加载过的地图图片 URL 记忆（模块级，跨组件实例共享）。
 * 用途：轮询/重挂载后，同一位置同一 URL 的图片不再走 视口门控 → lease →
 * 计时器 的完整请求链，直接用命中 URL 渲染，避免"图已显示又闪回占位"。
 * 键归一化：去掉 `_retry` 参数（同一图片的重试档视为同一图）。
 * 容量有界：最多 500 条，超出逐出最旧（插入序）。
 */

const MAX_LOADED_MAP_IMAGE_ENTRIES = 500

const loadedMapImageUrls = new Map<string, true>()

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
}

export function hasLoadedMapImage(url: string): boolean {
  const key = normalizeLoadedMapImageKey(url)
  return key ? loadedMapImageUrls.has(key) : false
}

export function resetLoadedMapImageCacheForTest(): void {
  loadedMapImageUrls.clear()
}
