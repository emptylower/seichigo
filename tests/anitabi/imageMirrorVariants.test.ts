import { describe, expect, it } from 'vitest'
import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'

describe('enumerateBangumiCoverVariants', () => {
  it('returns cover-l and cover-m variants for anitabi covers', () => {
    expect(
      enumerateBangumiCoverVariants('https://image.anitabi.cn/bangumi/123/cover.jpg'),
    ).toEqual([
      {
        label: 'cover-l',
        url: 'https://image.anitabi.cn/bangumi/123/cover.jpg?plan=l',
      },
      {
        label: 'cover-m',
        url: 'https://image.anitabi.cn/bangumi/123/cover.jpg',
      },
    ])
  })

  it('returns cover-l and cover-m labels for bgm covers even though canonicalization collapses both to /m/', () => {
    expect(
      enumerateBangumiCoverVariants('https://lain.bgm.tv/pic/cover/l/abcd.jpg'),
    ).toEqual([
      {
        label: 'cover-l',
        url: 'https://lain.bgm.tv/pic/cover/m/abcd.jpg',
      },
      {
        label: 'cover-m',
        url: 'https://lain.bgm.tv/pic/cover/m/abcd.jpg',
      },
    ])
  })

  it('returns an empty list for null, empty, and invalid inputs', () => {
    expect(enumerateBangumiCoverVariants(null)).toEqual([])
    expect(enumerateBangumiCoverVariants('   ')).toEqual([])
    expect(enumerateBangumiCoverVariants('/bangumi/123/cover.jpg')).toEqual([])
  })
})

describe('enumeratePointImageVariants', () => {
  it('returns the expected anitabi point variants', () => {
    const variants = enumeratePointImageVariants('https://image.anitabi.cn/points/abc.jpg')

    expect(variants).toEqual([
      {
        label: 'h160',
        url: 'https://image.anitabi.cn/points/abc.jpg?plan=h160',
      },
      {
        label: 'h320',
        url: 'https://image.anitabi.cn/points/abc.jpg?plan=h320',
      },
      {
        label: 'w640q80',
        url: 'https://image.anitabi.cn/points/abc.jpg?q=80&w=640',
      },
    ])
  })

  it('returns canonical point URLs with an anitabi points base', () => {
    const variants = enumeratePointImageVariants('https://image.anitabi.cn/points/abc.jpg')

    expect(variants).toHaveLength(3)
    for (const variant of variants) {
      expect(variant.url.startsWith('https://image.anitabi.cn/points/abc.jpg?')).toBe(true)
    }
  })

  it('removes conflicting point resize params for each returned variant', () => {
    const variants = enumeratePointImageVariants(
      'https://image.anitabi.cn/points/abc.jpg?plan=h320&w=999&h=111&q=10',
    )

    expect(variants).toEqual([
      {
        label: 'h160',
        url: 'https://image.anitabi.cn/points/abc.jpg?plan=h160',
      },
      {
        label: 'h320',
        url: 'https://image.anitabi.cn/points/abc.jpg?plan=h320',
      },
      {
        label: 'w640q80',
        url: 'https://image.anitabi.cn/points/abc.jpg?q=80&w=640',
      },
    ])
  })

  it('returns an empty list for non-anitabi point URLs and invalid inputs', () => {
    expect(enumeratePointImageVariants('https://lain.bgm.tv/pic/cover/l/abcd.jpg')).toEqual([])
    expect(enumeratePointImageVariants(null)).toEqual([])
    expect(enumeratePointImageVariants('')).toEqual([])
    expect(enumeratePointImageVariants('/points/abc.jpg')).toEqual([])
  })
})
