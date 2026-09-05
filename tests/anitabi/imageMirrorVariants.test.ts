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

  it('returns only the distinct canonical bgm cover variant', () => {
    expect(
      enumerateBangumiCoverVariants('https://lain.bgm.tv/pic/cover/l/abcd.jpg'),
    ).toEqual([
      {
        label: 'cover-m',
        url: 'https://lain.bgm.tv/pic/cover/m/abcd.jpg',
      },
    ])
  })

  it('rewrites bgm-api relay covers to the lain.bgm.tv variant set', () => {
    // bgm-api.anitabi.cn 命中 isAnitabiHost 但并非 anitabi 图片 CDN —— 必须先归一回
    // lain.bgm.tv 再枚举，否则会因 /bangumi/ 路径检查返回空列表、丢掉全部镜像变体。
    expect(
      enumerateBangumiCoverVariants('https://bgm-api.anitabi.cn/pic/cover/l/18/af/495291_Qd97X.jpg'),
    ).toEqual([
      {
        label: 'cover-m',
        url: 'https://lain.bgm.tv/pic/cover/m/18/af/495291_Qd97X.jpg',
      },
    ])
    expect(
      enumerateBangumiCoverVariants('https://bgm-api.anitabi.cn/img/pic/cover/l/a1/d3/325767_u3pvR.jpg'),
    ).toEqual([
      {
        label: 'cover-m',
        url: 'https://lain.bgm.tv/pic/cover/m/a1/d3/325767_u3pvR.jpg',
      },
    ])
  })

  it('removes conflicting resize params from apex and /images anitabi cover inputs', () => {
    expect(
      enumerateBangumiCoverVariants(
        'https://www.anitabi.cn/images/bangumi/123/cover.jpg?plan=h160&w=999&h=111&q=10',
      ),
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
        label: 'w640q80',
        url: 'https://image.anitabi.cn/points/abc.jpg?q=80&w=640',
      },
    ])
  })

  it('returns canonical point URLs with an anitabi points base', () => {
    const variants = enumeratePointImageVariants('https://image.anitabi.cn/points/abc.jpg')

    expect(variants).toHaveLength(2)
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
        label: 'w640q80',
        url: 'https://image.anitabi.cn/points/abc.jpg?q=80&w=640',
      },
    ])
  })

  it('returns variants for user-uploaded point images', () => {
    const variants = enumeratePointImageVariants(
      'https://image.anitabi.cn/user/0/bangumi/1851/points/kkfsf6q9e-1716167149440.jpg',
    )
    expect(variants).toEqual([
      {
        label: 'h160',
        url: 'https://image.anitabi.cn/user/0/bangumi/1851/points/kkfsf6q9e-1716167149440.jpg?plan=h160',
      },
      {
        label: 'w640q80',
        url: 'https://image.anitabi.cn/user/0/bangumi/1851/points/kkfsf6q9e-1716167149440.jpg?q=80&w=640',
      },
    ])
  })

  it('returns variants for user-uploaded point images with non-zero uid', () => {
    const variants = enumeratePointImageVariants(
      'https://image.anitabi.cn/user/1181/bangumi/321/points/n7zunh4aj.jpg?plan=h160',
    )
    expect(variants).toHaveLength(2)
    expect(variants[0].url).toBe(
      'https://image.anitabi.cn/user/1181/bangumi/321/points/n7zunh4aj.jpg?plan=h160',
    )
  })

  it('returns variants for /images/ prefixed user-uploaded point images', () => {
    const variants = enumeratePointImageVariants(
      'https://www.anitabi.cn/images/user/0/bangumi/1851/points/test.jpg',
    )
    expect(variants).toHaveLength(2)
  })

  it('returns an empty list for non-anitabi point URLs and invalid inputs', () => {
    expect(enumeratePointImageVariants('https://lain.bgm.tv/pic/cover/l/abcd.jpg')).toEqual([])
    expect(enumeratePointImageVariants(null)).toEqual([])
    expect(enumeratePointImageVariants('')).toEqual([])
    expect(enumeratePointImageVariants('/points/abc.jpg')).toEqual([])
  })

  it('rejects user paths that do not match the expected pattern', () => {
    expect(enumeratePointImageVariants('https://image.anitabi.cn/user/abc/bangumi/1/points/x.jpg')).toEqual([])
    expect(enumeratePointImageVariants('https://image.anitabi.cn/user/0/other/1/points/x.jpg')).toEqual([])
  })
})
