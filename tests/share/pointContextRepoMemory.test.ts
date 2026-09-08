import { describe, expect, it } from 'vitest'
import { MemoryPointContextRepo } from '@/lib/share/pointContextRepoMemory'
import type { PointContextRow } from '@/lib/share/pointContextRepo'

const ROW: PointContextRow = {
  pointId: '101:budo',
  bangumiId: 101,
  ep: '3',
  scene: '1194',
  image: 'https://image.anitabi.cn/points/101/budo.jpg',
  name: '『摇曳露营△ SEASON 3』葡萄牛奶',
  localizedName: null,
  mark: '武州屋出品',
  localizedNote: null,
  geoLat: 35.7,
  geoLng: 139.56,
  localizedBangumiTitle: '摇曳露营△ 三期',
  bangumiTitleCandidates: ['摇曳露营△ SEASON 3', 'ゆるキャン△ SEASON3'],
  bangumiTitles: { zh: '摇曳露营△', jaRaw: 'ゆるキャン△', original: null, romaji: null, english: null },
}

describe('MemoryPointContextRepo', () => {
  it('findPoint 命中与未命中', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    expect((await repo.findPoint('101:budo', 'zh'))?.name).toBe(ROW.name)
    expect(await repo.findPoint('nope', 'zh')).toBeNull()
  })

  it('地址初始为空，saveAddress 之后能读回', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    expect(await repo.findAddress('101:budo')).toBeNull()
    await repo.saveAddress({
      pointId: '101:budo',
      addressZh: '东京都 武藏野市 中町一丁目',
      addressEn: 'Nakacho 1-chome, Musashino, Tokyo',
      addressJa: '東京都 武蔵野市 中町一丁目',
      source: 'maptiler',
    })
    expect(await repo.findAddress('101:budo')).toEqual({
      pointId: '101:budo',
      addressZh: '东京都 武藏野市 中町一丁目',
      addressEn: 'Nakacho 1-chome, Musashino, Tokyo',
      addressJa: '東京都 武蔵野市 中町一丁目',
    })
  })

  it('saveAddress 覆盖同一 pointId', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    await repo.saveAddress({ pointId: '101:budo', addressZh: 'A', addressEn: null, addressJa: null, source: 'maptiler' })
    await repo.saveAddress({ pointId: '101:budo', addressZh: 'B', addressEn: null, addressJa: null, source: 'maptiler' })
    expect((await repo.findAddress('101:budo'))?.addressZh).toBe('B')
  })

  it('返回的是副本，改外面不影响仓库', async () => {
    const repo = new MemoryPointContextRepo([ROW])
    const first = (await repo.findPoint('101:budo', 'zh'))!
    first.name = 'mutated'
    expect((await repo.findPoint('101:budo', 'zh'))?.name).toBe(ROW.name)
  })

  it('countResolvedSince 只数 since 之后回填的行', async () => {
    const repo = new MemoryPointContextRepo([ROW], () => new Date('2026-09-08T12:00:00Z'))
    expect(await repo.countResolvedSince(new Date('2026-09-08T00:00:00Z'))).toBe(0)
    await repo.saveAddress({
      pointId: '101:budo',
      addressZh: '东京都',
      addressEn: null,
      addressJa: null,
      source: 'maptiler',
    })
    expect(await repo.countResolvedSince(new Date('2026-09-08T00:00:00Z'))).toBe(1)
    expect(await repo.countResolvedSince(new Date('2026-09-09T00:00:00Z'))).toBe(0)
  })
})
