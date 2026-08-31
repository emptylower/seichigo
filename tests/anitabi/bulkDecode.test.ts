import { describe, expect, it } from 'vitest'
import {
  BulkDecodeError,
  canonicalizeBulkAssetUrl,
  decodeBulkIndex,
  decodeBulkPage,
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
  it('upgrades http to https and passes absolute urls through', () => {
    expect(canonicalizeBulkAssetUrl('http://bgm-api.anitabi.cn/pic/a.jpg'))
      .toBe('https://bgm-api.anitabi.cn/pic/a.jpg')
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
    expect(e.cover).toBe('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg')
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
  it('throws on malformed entries', () => {
    expect(() => decodeBulkPage('nope')).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, 'not-points', 5]])).toThrow(BulkDecodeError)
    expect(() => decodeBulkPage([[1, 0, [['', 'x']], 5]])).toThrow(BulkDecodeError)
  })
})
