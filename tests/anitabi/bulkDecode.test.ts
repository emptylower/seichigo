import { describe, expect, it } from 'vitest'
import {
  BulkDecodeError,
  canonicalizeBulkAssetUrl,
  decodeBulkIndex,
  decodeBulkPage,
  normalizeBulkBangumi,
  normalizePointsFromBulk,
} from '@/lib/anitabi/source/bulkDecode'

/** 按 B 节字段表构造的最小真实形状索引行。 */
function makeIndexRow(id: number) {
  return [
    id, '再见，拉拉', 'Goodbye!rara', 'さよならララ', '大津市', '#c72d38',
    'http://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg', 8, 'TV',
    34.978141, 135.905931, 19.2,
    ['1zqx9nu', 35.005218, 135.863706, 682, 'gt9wos1', 34.991532, 135.895657, 3],
    0, ['催泪', '日常'], 999, 0, 0,
  ]
}

describe('canonicalizeBulkAssetUrl', () => {
  it('strips /images prefix onto canonical host', () => {
    expect(canonicalizeBulkAssetUrl('/images/points/495291/1zqx9nu_1751348772406.jpg'))
      .toBe('https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg')
  })
  it('upgrades http to https and rewrites bgm-api relay urls to lain.bgm.tv', () => {
    expect(canonicalizeBulkAssetUrl('http://bgm-api.anitabi.cn/pic/a.jpg'))
      .toBe('https://lain.bgm.tv/pic/a.jpg')
  })
  it('strips the /img relay mount prefix from absolute bgm-api urls', () => {
    expect(canonicalizeBulkAssetUrl('https://bgm-api.anitabi.cn/img/pic/cover/l/a1/d3/325767_u3pvR.jpg'))
      .toBe('https://lain.bgm.tv/pic/cover/l/a1/d3/325767_u3pvR.jpg')
  })
  it('passes other absolute urls through on https unchanged', () => {
    expect(canonicalizeBulkAssetUrl('http://img.example.com/a.jpg'))
      .toBe('https://img.example.com/a.jpg')
  })
  it('treats 0 / empty as absent', () => {
    expect(canonicalizeBulkAssetUrl(0)).toBeNull()
    expect(canonicalizeBulkAssetUrl('')).toBeNull()
  })
})

describe('decodeBulkIndex', () => {
  it('decodes rows with 4-stride point refs', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398])
    expect(idx.modified).toBe(1787937388398)
    expect(idx.pageSize).toBe(250)
    expect(idx.pageCount).toBe(1)
    const e = idx.entries[0]!
    expect(e.id).toBe(495291)
    expect(e.cn).toBe('再见，拉拉')
    expect(e.cat).toBe('TV')
    expect(e.tags).toEqual(['催泪', '日常'])
    // bgm-api 中转域在入库前归一回 lain.bgm.tv（http 同时升级 https）
    expect(e.cover).toBe('https://lain.bgm.tv/pic/cover/l/18/af/495291_Qd97X.jpg')
    expect(e.points).toEqual([
      { id: '1zqx9nu', geoLat: 35.005218, geoLng: 135.863706 },
      { id: 'gt9wos1', geoLat: 34.991532, geoLng: 135.895657 },
    ])
  })
  it('throws BulkDecodeError on malformed payloads', () => {
    expect(() => decodeBulkIndex(null)).toThrow(BulkDecodeError)
    expect(() => decodeBulkIndex([[], 250, 1])).toThrow(BulkDecodeError)
    // 点位展平数组长度必须是 4 的倍数 —— 截断文件的典型症状
    const bad = makeIndexRow(1); (bad[12] as unknown[]).push('extra')
    expect(() => decodeBulkIndex([[bad], 250, 1787937388398])).toThrow(BulkDecodeError)
  })
})

/** 分页点位行，字段位置见计划 B 节。cn=0、origin=0 表示上游"无此值"。 */
function makePagePoint(id: string, over: Record<number, unknown> = {}) {
  const row: unknown[] = [
    id, '大津自行车道线', 0, 0, 0, 1127,
    `/images/points/495291/${id}_1751348772406.jpg`, 0,
    'PV1', '', '画面前景几栋高楼位于此处', 0, 0, '航拍', 682,
  ]
  for (const [k, v] of Object.entries(over)) row[Number(k)] = v
  return row
}

describe('decodeBulkPage', () => {
  it('decodes entries with theme and points', () => {
    const page = decodeBulkPage([[
      495291,
      ['/images/ptheme/495291_100_76.webp?v=hqozf', ['1zqx9nu'], 1787934423695, 100, 76],
      [makePagePoint('1zqx9nu')],
      1787934434449,
    ]])
    const e = page[0]!
    expect(e.id).toBe(495291)
    expect(e.modified).toBe(1787934434449)
    expect(e.theme).toEqual({
      src: 'https://image.anitabi.cn/ptheme/495291_100_76.webp?v=hqozf',
      ids: ['1zqx9nu'], modified: 1787934423695, w: 100, h: 76,
    })
    const p = e.points[0]!
    expect(p).toMatchObject({
      id: '1zqx9nu',
      name: '大津自行车道线',
      cn: undefined,               // 0 → 缺失
      isFolder: false,
      uid: '1127',                 // 数值 uid 统一成字符串
      image: 'https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg',
      ep: 'PV1',
      s: undefined,                // "" → 缺失
      mark: '画面前景几栋高楼位于此处',
      folder: '航拍',
      density: 682,
    })
  })
  it('theme=0 decodes to null; ep 数值保留（含 0）', () => {
    const page = decodeBulkPage([[1, 0, [makePagePoint('a1', { 8: 0 })], 5]])
    expect(page[0]!.theme).toBeNull()
    expect(page[0]!.points[0]!.ep).toBe('0')
  })
  it('density 超出 Postgres int32 范围时视为缺失，而不是原样透传', () => {
    // 2026-08-31 Task 9 沙箱真实数据触发：density=110999999889000 撞穿
    // AnitabiPoint.density 的 Int 列上限（2147483647），导致 createMany 崩溃。
    const page = decodeBulkPage([[1, 0, [makePagePoint('a1', { 14: 110999999889000 })], 5]])
    expect(page[0]!.points[0]!.density).toBeUndefined()
  })
  it('density 恰为 int32 上限时保留；负数视为缺失', () => {
    const atMax = decodeBulkPage([[1, 0, [makePagePoint('a1', { 14: 2147483647 })], 5]])
    expect(atMax[0]!.points[0]!.density).toBe(2147483647)
    const negative = decodeBulkPage([[1, 0, [makePagePoint('a1', { 14: -5 })], 5]])
    expect(negative[0]!.points[0]!.density).toBeUndefined()
  })
  it('throws on malformed entries', () => {
    expect(() => decodeBulkPage('nope')).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, 'not-points', 5]])).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, [['', 'x']], 5]])).toThrow(BulkDecodeError)
  })
})

describe('normalizePointsFromBulk', () => {
  it('merges geo from index refs and scopes point ids', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398]).entries[0]!
    const page = decodeBulkPage([[495291, 0, [makePagePoint('1zqx9nu')], 5]])[0]!
    const pts = normalizePointsFromBulk(idx, page)
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({
      id: '495291:1zqx9nu',
      bangumiId: 495291,
      name: '大津自行车道线',
      nameZh: null,
      geoLat: 35.005218,
      geoLng: 135.863706,
      ep: 'PV1',
      s: null,
      image: 'https://image.anitabi.cn/points/495291/1zqx9nu_1751348772406.jpg',
      origin: null,
      originLink: null,
      density: 682,
      mark: '画面前景几栋高楼位于此处',
      folder: '航拍',
      uid: '1127',
    })
    // 冻结字段绝不产出键（写库方据此跳过）
    expect('originUrl' in pts[0]!).toBe(false)
    expect('reviewUid' in pts[0]!).toBe(false)
  })
})

describe('normalizeBulkBangumi', () => {
  it('builds bangumi fields from index entry + page modified', () => {
    const idx = decodeBulkIndex([[makeIndexRow(495291)], 250, 1787937388398]).entries[0]!
    const b = normalizeBulkBangumi(idx, 1787934434449)
    expect(b).toMatchObject({
      id: 495291,
      titleZh: '再见，拉拉',
      titleJaRaw: 'さよならララ',
      cat: 'TV',
      tags: ['催泪', '日常'],
      city: '大津市',
      color: '#c72d38',
      geoLat: 34.978141,
      geoLng: 135.905931,
      zoom: 19.2,
      sourceModifiedMs: BigInt(1787934434449),
    })
  })
})
