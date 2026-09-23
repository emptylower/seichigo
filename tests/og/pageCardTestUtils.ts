import { vi } from 'vitest'
import type { PageCardDeps } from '@/lib/og/handlers/pageCard'
import type { PageCardContent } from '@/lib/og/pageCardContent'
import type { ShareStore } from '@/lib/share/store'

/** tests/og/pageCard*.test.ts 共用的内存 R2 / deps / 请求构造 */
export const NOW = new Date('2026-09-23T12:00:00Z')

export const CONTENT: PageCardContent = {
  title: '《孤独摇滚》下北泽巡礼',
  subtitle: '孤独摇滚 · 东京',
  cover: 'https://image.anitabi.cn/points/bocchi.jpg',
}

/** 兜底链 ③ 的 site/home 卡内容（无封面 → 品牌渐变块） */
export const SITE_CONTENT: PageCardContent = {
  title: 'SeichiGo',
  subtitle: null,
  cover: null,
}

export function makeStore(seed?: Record<string, Uint8Array>) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  for (const [key, bytes] of Object.entries(seed ?? {})) {
    objects.set(key, { bytes, contentType: key.endsWith('.json') ? 'application/json' : 'image/jpeg' })
  }
  const store: ShareStore = {
    async put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async get(key) {
      const found = objects.get(key)
      if (!found) return null
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(found.bytes)
            controller.close()
          },
        }),
        contentType: found.contentType,
        size: found.bytes.byteLength,
      }
    },
    async head(key) {
      const found = objects.get(key)
      if (!found) return null
      return { size: found.bytes.byteLength, contentType: found.contentType }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

export function makeDeps(overrides: Partial<PageCardDeps> = {}): PageCardDeps {
  const { store } = makeStore()
  return {
    getStore: () => store,
    renderCard: vi.fn(async () => new Uint8Array([1, 2, 3])),
    fetchImage: async () => ({ status: 'ok', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    resolveAnimeImageUrl: async () => null,
    loadContent: async () => CONTENT,
    now: () => NOW,
    origin: 'https://seichigo.com',
    ...overrides,
  }
}

export function get(url: string, ip?: string): Request {
  return new Request(url, { headers: ip ? { 'cf-connecting-ip': ip } : undefined })
}

export const segParams = (...segments: string[]) => ({ params: Promise.resolve({ segments }) })
export const URL_BASE = 'https://seichigo.com/api/og'
