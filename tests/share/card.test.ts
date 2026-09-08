import { describe, expect, it, vi } from 'vitest'
import {
  cardCacheKey,
  isCheckinPhotoKey,
  normalizeCardLayout,
  normalizeCardLocale,
  renderAndStoreCard,
} from '@/lib/share/handlers/card'
import type { CardDeps } from '@/lib/share/handlers/card'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'
import type { ShareStore } from '@/lib/share/store'

const NOW = new Date('2026-09-08T12:00:00Z')

const ROW: PointContextRow = {
  pointId: '101:suga',
  bangumiId: 101,
  ep: '1',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/suga.jpg',
  name: '《你的名字。》须贺神社',
  localizedName: null,
  mark: '男女主角重逢的阶梯',
  localizedNote: null,
  geoLat: 35.6895,
  geoLng: 139.7,
  localizedBangumiTitle: '你的名字。',
  bangumiTitleCandidates: ['你的名字。'],
  bangumiTitles: { zh: '你的名字。', jaRaw: null, original: null, romaji: null, english: null },
}

export function makeStore(seed?: Record<string, Uint8Array>) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  for (const [key, bytes] of Object.entries(seed ?? {})) {
    objects.set(key, { bytes, contentType: 'image/webp' })
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
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

export function makeDeps(overrides: Partial<CardDeps> = {}): CardDeps {
  const { store } = makeStore()
  return {
    repo: new MemoryPointContextRepo([ROW]),
    geocode: async () => null,
    getStore: () => store,
    renderCard: vi.fn(async () => new Uint8Array([0x52, 0x49, 0x46, 0x46])),
    resolveAnimeImageUrl: async () => 'https://img.seichigo.com/mirror/v1/x/y.jpg',
    fetchImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
    origin: 'https://seichigo.com',
    now: () => NOW,
    ...overrides,
  }
}

describe('参数归一', () => {
  it('locale 非法回落 zh，layout 非法回落 landscape', () => {
    expect(normalizeCardLocale('ja')).toBe('ja')
    expect(normalizeCardLocale('de')).toBe('zh')
    expect(normalizeCardLocale(null)).toBe('zh')
    expect(normalizeCardLayout('portrait')).toBe('portrait')
    expect(normalizeCardLayout('square')).toBe('landscape')
  })

  it('photo 只接受 checkin/<userId>/<pointId>.jpg 形状', () => {
    expect(isCheckinPhotoKey('checkin/u1/101:suga.jpg')).toBe(true)
    expect(isCheckinPhotoKey('share/AbC12xYz-deadbeef.webp')).toBe(false)
    expect(isCheckinPhotoKey('checkin/../../etc/passwd.jpg')).toBe(false)
    expect(isCheckinPhotoKey('checkin/u1/p.png')).toBe(false)
    expect(isCheckinPhotoKey('')).toBe(false)
  })
})

describe('cardCacheKey', () => {
  it('无实拍时按 pointId__locale__layout', async () => {
    expect(await cardCacheKey('101:suga', 'zh', 'landscape', null)).toBe(
      'og-cards/101:suga__zh__landscape.webp',
    )
  })

  it('带实拍时追加 photoKey 的 sha256 前 12 位', async () => {
    const key = await cardCacheKey('101:suga', 'ja', 'portrait', 'checkin/u1/101:suga.jpg')
    expect(key.startsWith('og-cards/101:suga__ja__portrait__')).toBe(true)
    expect(/__[0-9a-f]{12}\.webp$/.test(key)).toBe(true)
  })

  it('同一实拍 key 两次算出同一缓存键', async () => {
    const a = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    const b = await cardCacheKey('p', 'zh', 'landscape', 'checkin/u1/p.jpg')
    expect(a).toBe(b)
  })
})

describe('renderAndStoreCard', () => {
  it('渲染成功后写进 R2 并返回字节', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store })
    const bytes = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(bytes).not.toBeNull()
    expect(objects.get('og-cards/101:suga__zh__landscape.webp')?.contentType).toBe('image/webp')
  })

  it('把动画截图内联成 base64 传给渲染器，HTML 里不留外链', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    const deps = makeDeps({ renderCard })
    await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    const html = renderCard.mock.calls[0]![0].html
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).not.toContain('https://img.seichigo.com')
  })

  it('取动画截图失败时用粉色渐变兜底，仍然出图', async () => {
    const deps = makeDeps({ fetchImage: async () => null })
    const bytes = await renderAndStoreCard(deps, {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: null,
    })
    expect(bytes).not.toBeNull()
  })

  it('二维码编码的是稳定深链，不含短码', async () => {
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    await renderAndStoreCard(makeDeps({ renderCard }), {
      pointId: '101:suga',
      locale: 'ja',
      layout: 'portrait',
      photoKey: null,
    })
    // 深链本身只出现在二维码的模块里，这里断言 HTML 没有短链路径
    expect(renderCard.mock.calls[0]![0].html).not.toContain('/s/')
  })

  it('点位不存在返回 null 且不写 R2', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, repo: new MemoryPointContextRepo([]) })
    expect(
      await renderAndStoreCard(deps, {
        pointId: 'nope',
        locale: 'zh',
        layout: 'landscape',
        photoKey: null,
      }),
    ).toBeNull()
    expect(objects.size).toBe(0)
  })

  it('渲染器返回 null 时不写缓存', async () => {
    const { store, objects } = makeStore()
    const deps = makeDeps({ getStore: () => store, renderCard: async () => null })
    expect(
      await renderAndStoreCard(deps, {
        pointId: '101:suga',
        locale: 'zh',
        layout: 'landscape',
        photoKey: null,
      }),
    ).toBeNull()
    expect(objects.size).toBe(0)
  })

  it('带实拍时从 ASSET_STORE 读原图并内联', async () => {
    const photo = new Uint8Array([9, 9, 9])
    const { store } = makeStore({ 'checkin/u1/101:suga.jpg': photo })
    const renderCard = vi.fn(async () => new Uint8Array([1]))
    await renderAndStoreCard(makeDeps({ getStore: () => store, renderCard }), {
      pointId: '101:suga',
      locale: 'zh',
      layout: 'landscape',
      photoKey: 'checkin/u1/101:suga.jpg',
    })
    expect(renderCard.mock.calls[0]![0].html).toContain('data:image/webp;base64,CQkJ')
  })
})
