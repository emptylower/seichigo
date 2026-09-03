import { describe, it, expect, vi } from 'vitest'
import { mirrorPlacePhoto, refreshPhotoReference, fetchPlacePhotos } from '@/lib/googlePlaces/photoMirror'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { ExternalPlaceStore } from '@/lib/googlePlaces/store'
import type { R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import type { ResolvedPlace } from '@/lib/googlePlaces/places'

const place: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_newchitose',
  name: '新千歳空港',
  address: null,
  lat: 42.7889,
  lng: 141.6947,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_newchitose',
  photo: {
    photoReference: 'Aref_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600',
    attribution: null,
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

function imageResponse(bytes = new Uint8Array([1, 2, 3]).buffer): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes,
  } as unknown as Response
}

function makeBucket(): { bucket: R2MirrorBucket; put: ReturnType<typeof vi.fn> } {
  const put = vi.fn(async () => undefined)
  return {
    bucket: { head: vi.fn(async () => null), get: vi.fn(async () => null), put },
    put,
  }
}

describe('mirrorPlacePhoto（解析后后台镜像到 R2）', () => {
  it('无 bucket 或无 photoReference → skipped，store 不变', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '新千歳空港')
    const fetchImpl = vi.fn()

    const noBucket = await mirrorPlacePhoto({ store, apiKey: 'k', fetchImpl, place })
    expect(noBucket).toMatchObject({ status: 'skipped' })
    expect(fetchImpl).not.toHaveBeenCalled()

    const noRef = await mirrorPlacePhoto({
      store,
      bucket: makeBucket().bucket,
      apiKey: 'k',
      fetchImpl,
      place: { ...place, photo: null },
    })
    expect(noRef).toMatchObject({ status: 'skipped' })
    expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('none')
  })

  it('有 bucket 且抓取成功 → bucket.put 被调用、store.setPhotoMirror 落 mirrored + key', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '新千歳空港')
    const setPhotoMirror = vi.fn(store.setPhotoMirror.bind(store))
    const wrapped: ExternalPlaceStore = { ...store, setPhotoMirror }
    const { bucket, put } = makeBucket()
    const fetchImpl = vi.fn(async () => imageResponse())

    const result = await mirrorPlacePhoto({ store: wrapped, bucket, apiKey: 'k', fetchImpl, place })
    expect(result.status).toBe('mirrored')
    expect(typeof result.key).toBe('string')
    expect(put).toHaveBeenCalledTimes(1)
    const [key, , options] = put.mock.calls[0] as unknown as [string, ArrayBuffer, { customMetadata: Record<string, string> }]
    expect(key).toContain('maps.googleapis.com')
    // canonical（R2 key 输入）不含 key 参数
    expect(options.customMetadata.originalUrl).not.toContain('key=')
    expect(options.customMetadata.originalUrl).toContain('placeid=ChIJ_newchitose')
    expect(setPhotoMirror).toHaveBeenCalledWith(
      'google',
      place.placeId,
      expect.objectContaining({ status: 'mirrored', key: expect.any(String), mirroredAt: expect.any(Date) }),
    )
    expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('mirrored')
  })

  it('抓取失败 → store.setPhotoMirror 落 failed', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '新千歳空港')
    const { bucket } = makeBucket()
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }) as unknown as Response)
    const result = await mirrorPlacePhoto({ store, bucket, apiKey: 'k', fetchImpl, place })
    expect(result).toMatchObject({ status: 'failed' })
    expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('failed')
  })
})

describe('refreshPhotoReference（引用过期时用 Place Details 刷新）', () => {
  it('返回 result.photos[0] 的新引用与纯文本署名', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      ({
        ok: true,
        json: async () => ({
          status: 'OK',
          result: {
            photos: [
              {
                photo_reference: 'Anew_REF_9876543210',
                html_attributions: ['<a href="https://maps.google.com/maps/contrib/2">Photo by New</a>'],
              },
            ],
          },
        }),
      }) as unknown as Response,
    )
    const refreshed = await refreshPhotoReference({ placeId: place.placeId, apiKey: 'SECRET_KEY', fetchImpl })
    expect(refreshed).toEqual({ photoReference: 'Anew_REF_9876543210', attribution: 'Photo by New' })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('place_id=ChIJ_newchitose')
    expect(url).toContain('fields=photos')
    expect(url).toContain('key=SECRET_KEY')
  })

  it('无照片/请求失败 → null', async () => {
    const empty = await refreshPhotoReference({
      placeId: place.placeId,
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'OK', result: {} }) }) as unknown as Response),
    })
    expect(empty).toBeNull()

    const failing = await refreshPhotoReference({
      placeId: place.placeId,
      apiKey: 'k',
      fetchImpl: vi.fn(async () => {
        throw new Error('timeout')
      }),
    })
    expect(failing).toBeNull()
  })
})

describe('fetchPlacePhotos（A4：整组照片补拉，Place Details fields=photos）', () => {
  it('返回最多 10 个合法引用（含署名清洗）；非法引用被跳过', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      photo_reference: `Aref_photo_${String(i).padStart(4, '0')}`,
      html_attributions: i % 2 === 0 ? [`<a href="https://maps.google.com/maps/contrib/${i}">Photo by ${i}</a>`] : [],
    }))
    many.push({ photo_reference: 'bad ref!', html_attributions: [] })
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      ({ ok: true, json: async () => ({ status: 'OK', result: { photos: many } }) }) as unknown as Response,
    )
    const photos = await fetchPlacePhotos({ placeId: place.placeId, apiKey: 'SECRET_KEY', fetchImpl })
    expect(photos).toHaveLength(10)
    expect(photos![0]).toEqual({ photoReference: 'Aref_photo_0000', attribution: 'Photo by 0' })
    expect(photos![1]).toEqual({ photoReference: 'Aref_photo_0001', attribution: null })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toContain('place_id=ChIJ_newchitose')
    expect(url).toContain('fields=photos')
    expect(url).toContain('key=SECRET_KEY')
  })

  it('返回 3 张照片：引用与署名逐项对齐', async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: true,
        json: async () => ({
          status: 'OK',
          result: {
            photos: [
              { photo_reference: 'Aref_three___01', html_attributions: ['<a href="x">A1</a>'] },
              { photo_reference: 'Aref_three___02', html_attributions: [] },
              { photo_reference: 'Aref_three___03', html_attributions: ['<a href="y">A3</a>'] },
            ],
          },
        }),
      }) as unknown as Response,
    )
    const photos = await fetchPlacePhotos({ placeId: place.placeId, apiKey: 'k', fetchImpl })
    expect(photos).toEqual([
      { photoReference: 'Aref_three___01', attribution: 'A1' },
      { photoReference: 'Aref_three___02', attribution: null },
      { photoReference: 'Aref_three___03', attribution: 'A3' },
    ])
  })

  it('无照片/请求失败/异常状态 → null', async () => {
    const empty = await fetchPlacePhotos({
      placeId: place.placeId,
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'OK', result: {} }) }) as unknown as Response),
    })
    expect(empty).toBeNull()
    const denied = await fetchPlacePhotos({
      placeId: place.placeId,
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ status: 'REQUEST_DENIED' }) }) as unknown as Response),
    })
    expect(denied).toBeNull()
    const failing = await fetchPlacePhotos({
      placeId: place.placeId,
      apiKey: 'k',
      fetchImpl: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    expect(failing).toBeNull()
  })
})
