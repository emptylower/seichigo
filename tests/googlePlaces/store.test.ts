import { describe, it, expect } from 'vitest'
import { createMemoryExternalPlaceStore } from '@/lib/googlePlaces/storeMemory'
import type { ResolvedPlace } from '@/lib/googlePlaces/places'

const place: ResolvedPlace = {
  provider: 'google',
  placeId: 'ChIJ_newchitose',
  name: '新千歳空港',
  address: '北海道千歳市美里',
  lat: 42.7889,
  lng: 141.6947,
  mapsUri: 'https://www.google.com/maps/place/?q=place_id:ChIJ_newchitose',
  photo: {
    photoReference: 'Aref_1234567890',
    displayUrl: '/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600',
    attribution: 'Photo by Someone',
  },
  fetchedAt: '2026-09-02T00:00:00.000Z',
}

describe('createMemoryExternalPlaceStore（内存实现，测试/降级用）', () => {
  it('upsert 后按归一化查询词与 placeId 都能命中；30 天后按查询词未命中、按 placeId 仍命中', async () => {
    const now = { value: Date.parse('2026-09-02T00:00:00Z') }
    const store = createMemoryExternalPlaceStore({ now: () => now.value })
    await store.upsert({ ...place, fetchedAt: new Date(now.value).toISOString() }, '新千歳空港')
    expect((await store.findByQuery('google', '新千歳空港'))?.placeId).toBe(place.placeId)
    expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('none')

    now.value += 31 * 24 * 3600 * 1000
    expect(await store.findByQuery('google', '新千歳空港')).toBeNull()
    expect(await store.findByPlaceId('google', place.placeId)).not.toBeNull()
  })

  it('未知查询词/placeId 返回 null；normalizedQuery=null 不注册查询词', async () => {
    const store = createMemoryExternalPlaceStore()
    expect(await store.findByQuery('google', '不存在的查询')).toBeNull()
    expect(await store.findByPlaceId('google', 'ChIJ_unknown')).toBeNull()

    await store.upsert(place, null)
    expect(await store.findByQuery('google', '新千歳空港')).toBeNull()
    expect((await store.findByPlaceId('google', place.placeId))?.placeId).toBe(place.placeId)
  })

  it('setPhotoMirror / updatePhotoReference 更新对应字段', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '新千歳空港')

    await store.setPhotoMirror('google', place.placeId, { status: 'mirrored', key: 'mirror/v1/maps.googleapis.com/abc/.jpg' })
    const mirrored = await store.findByPlaceId('google', place.placeId)
    expect(mirrored?.photoMirrorStatus).toBe('mirrored')
    expect(mirrored?.photoMirrorKey).toBe('mirror/v1/maps.googleapis.com/abc/.jpg')

    await store.updatePhotoReference('google', place.placeId, 'Aref_9999999999', 'New Author')
    const refreshed = await store.findByPlaceId('google', place.placeId)
    expect(refreshed?.photo?.photoReference).toBe('Aref_9999999999')
    expect(refreshed?.photo?.attribution).toBe('New Author')
    // placeId 寻址的 displayUrl 不随引用变化
    expect(refreshed?.photo?.displayUrl).toBe('/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600')

    // 镜像状态跨字段更新保持
    await store.setPhotoMirror('google', place.placeId, { status: 'failed', key: null, mirroredAt: null })
    expect((await store.findByPlaceId('google', place.placeId))?.photoMirrorStatus).toBe('failed')
  })

  it('updatePhotoReference 刷新照片引用但不延长 30 天元数据 TTL（fetchedAt 不动）', async () => {
    const now = { value: Date.parse('2026-09-02T00:00:00Z') }
    const store = createMemoryExternalPlaceStore({ now: () => now.value })
    await store.upsert({ ...place, fetchedAt: new Date(now.value).toISOString() }, '新千歳空港')

    // 29 天时刷新引用：仍处于 TTL 内，查询词可命中且引用已更新
    now.value += 29 * 24 * 3600 * 1000
    await store.updatePhotoReference('google', place.placeId, 'Anew_REF_9999999999', 'New Author')
    expect((await store.findByQuery('google', '新千歳空港'))?.photo?.photoReference).toBe('Anew_REF_9999999999')

    // 原始 fetchedAt 起 31 天：查询词按过期未命中（引用刷新没有续期元数据）
    now.value += 2 * 24 * 3600 * 1000
    expect(await store.findByQuery('google', '新千歳空港')).toBeNull()
    // placeId 长期寻址不受影响，引用仍是新值
    expect((await store.findByPlaceId('google', place.placeId))?.photo?.photoReference).toBe('Anew_REF_9999999999')
  })

  it('A2：updatePhotos 覆盖写入整组照片，photoReference 列同步为 photos[0]，fetchedAt 不动', async () => {
    const now = { value: Date.parse('2026-09-02T00:00:00Z') }
    const store = createMemoryExternalPlaceStore({ now: () => now.value })
    await store.upsert({ ...place, fetchedAt: new Date(now.value).toISOString() }, '新千歳空港')

    now.value += 5 * 24 * 3600 * 1000
    await store.updatePhotos('google', place.placeId, [
      { photoReference: 'Aref_first_00001', attribution: 'First' },
      { photoReference: 'Aref_second_0002', attribution: 'Second' },
      { photoReference: 'Aref_third__0003', attribution: null },
    ])
    const record = await store.findByPlaceId('google', place.placeId)
    expect(record?.photos).toHaveLength(3)
    expect(record?.photos[0]).toEqual({ photoReference: 'Aref_first_00001', attribution: 'First' })
    expect(record?.photo?.photoReference).toBe('Aref_first_00001')
    expect(record?.photo?.attribution).toBe('First')
    expect(record?.photo?.displayUrl).toBe('/api/google/place-photo?placeId=ChIJ_newchitose&maxwidth=1600')
    // fetchedAt 不动（照片刷新不延长元数据 TTL）
    expect(record?.fetchedAt).toBe(new Date(Date.parse('2026-09-02T00:00:00Z')).toISOString())

    // upsert 带 photos 时整组入库；缺省时从 photo 派生单张
    await store.upsert(
      {
        ...place,
        placeId: 'ChIJ_with_photos',
        photos: [
          { photoReference: 'Aref_multi___01', attribution: null },
          { photoReference: 'Aref_multi___02', attribution: null },
        ],
      },
      null,
    )
    expect((await store.findByPlaceId('google', 'ChIJ_with_photos'))?.photos).toHaveLength(2)
    await store.upsert({ ...place, placeId: 'ChIJ_no_photos' }, null)
    expect((await store.findByPlaceId('google', 'ChIJ_no_photos'))?.photos).toEqual([
      { photoReference: 'Aref_1234567890', attribution: 'Photo by Someone' },
    ])
    await store.upsert({ ...place, placeId: 'ChIJ_no_photo2', photo: null }, null)
    expect((await store.findByPlaceId('google', 'ChIJ_no_photo2'))?.photos).toEqual([])
  })

  it('R7：先 updatePhotos 3 张，再 upsert 只带 1 张 → photos 整组保留、photoReference 对齐 photos[0]；upsert 无照片 → photos 清空', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '新千歳空港')
    await store.updatePhotos('google', place.placeId, [
      { photoReference: 'Aref_first_00001', attribution: 'First' },
      { photoReference: 'Aref_second_0002', attribution: 'Second' },
      { photoReference: 'Aref_third__0003', attribution: null },
    ])
    // 新解析结果只有 1 张（Text Search 常态）：保留库里整组，不用 1 张覆盖 3 张
    await store.upsert(
      {
        ...place,
        photo: { photoReference: 'Aref_solo_____x', displayUrl: '/api/google/place-photo?ref=Aref_solo_____x&maxwidth=1600', attribution: 'Solo' },
      },
      '新千歳空港',
    )
    const kept = await store.findByPlaceId('google', place.placeId)
    expect(kept?.photos).toHaveLength(3)
    expect(kept?.photo?.photoReference).toBe('Aref_first_00001')
    expect(kept?.photo?.attribution).toBe('First')

    // 新解析结果完全无照片：photos 清空（不残留旧值）
    await store.upsert({ ...place, photo: null }, '新千歳空港')
    const cleared = await store.findByPlaceId('google', place.placeId)
    expect(cleared?.photos).toEqual([])
    expect(cleared?.photo).toBeNull()
  })

  it('重复 upsert 同一查询词指向新 place 时改指（查询词键唯一）', async () => {
    const store = createMemoryExternalPlaceStore()
    await store.upsert(place, '空港')
    const other: ResolvedPlace = { ...place, placeId: 'ChIJ_other', name: '另一个空港' }
    await store.upsert(other, '空港')
    expect((await store.findByQuery('google', '空港'))?.placeId).toBe('ChIJ_other')
    expect(await store.findByPlaceId('google', place.placeId)).not.toBeNull()
    expect(await store.findByPlaceId('google', 'ChIJ_other')).not.toBeNull()
  })
})
