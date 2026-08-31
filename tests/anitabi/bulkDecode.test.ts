import { describe, expect, it } from 'vitest'
import {
  BulkDecodeError,
  canonicalizeBulkAssetUrl,
  decodeBulkIndex,
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
