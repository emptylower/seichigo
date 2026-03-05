import { describe, expect, it } from 'vitest'
import {
  buildAnimeSeoTitle,
  buildCitySeoTitle,
  buildPostFallbackTitle,
} from '@/lib/seo/titleBuilder'

describe('buildAnimeSeoTitle', () => {
  it('builds normal ZH anime title with cities', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [
      { city: '下北泽' },
      { city: '江之岛' },
      { city: '下北泽' }, // duplicate
      { city: '镰仓' }, // third city, should be ignored
    ]

    const result = buildAnimeSeoTitle(anime, posts, 'zh')

    expect(result).toEqual({
      absolute: '孤独摇滚 圣地巡礼攻略｜下北泽·江之岛',
    })
  })

  it('builds normal EN anime title with cities', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [{ city: 'Shimokitazawa' }, { city: 'Enoshima' }]

    const result = buildAnimeSeoTitle(anime, posts, 'en')

    // Full title is 65 chars, exceeds 60, so cities are dropped
    expect(result.absolute).toBe('Bocchi the Rock! Anime Pilgrimage Guide')
  })

  it('builds normal JA anime title with cities', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [{ city: '下北沢' }, { city: '江ノ島' }]

    const result = buildAnimeSeoTitle(anime, posts, 'ja')

    expect(result).toEqual({
      absolute: 'ぼっち・ざ・ろっく 聖地巡礼ガイド｜下北沢·江ノ島',
    })
  })

  it('handles null name_en with fallback (no keyword chimera)', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: null,
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [{ city: 'Shimokitazawa' }]

    const result = buildAnimeSeoTitle(anime, posts, 'en')

    // Should return name-only without English keyword suffix
    expect(result).toEqual({
      absolute: '孤独摇滚',
    })
  })

  it('handles undefined name_en with fallback', () => {
    const anime = {
      name: '孤独摇滚',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [{ city: 'Shimokitazawa' }]

    const result = buildAnimeSeoTitle(anime, posts, 'en')

    expect(result).toEqual({
      absolute: '孤独摇滚',
    })
  })

  it('handles null name_ja with fallback', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: null,
    }
    const posts = [{ city: '下北沢' }]

    const result = buildAnimeSeoTitle(anime, posts, 'ja')

    expect(result).toEqual({
      absolute: '孤独摇滚',
    })
  })

  it('handles long anime name - name + keyword fits, drops cities', () => {
    const anime = {
      name: '这是一个非常非常非常长的动画名字用来测试截断功能', // 24 chars
      name_en: 'Short Name',
      name_ja: 'ショート',
    }
    const posts = [{ city: '下北泽' }, { city: '江之岛' }]

    const result = buildAnimeSeoTitle(anime, posts, 'zh')

    // Full title with cities would be 39 chars, exceeds 30
    // Name (24) + ' 圣地巡礼攻略' (7) = 31 chars, still exceeds 30
    // Should drop keyword and return name only
    expect(result.absolute).toBe('这是一个非常非常非常长的动画名字用来测试截断功能')
  })

  it('handles very long anime name - even keyword exceeds limit, drops keyword', () => {
    const anime = {
      name: '这是一个超级超级超级超级超级超级长的动画名字', // 24 chars
      name_en: 'Short',
      name_ja: 'ショート',
    }
    const posts = [{ city: '下北泽' }]

    const result = buildAnimeSeoTitle(anime, posts, 'zh')

    // Actual string '这是一个超级超级超级超级超级超级长的动画名字 圣地巡礼攻略' is 29 chars, fits!
    expect(result.absolute).toBe('这是一个超级超级超级超级超级超级长的动画名字 圣地巡礼攻略')
  })

  it('handles long EN anime name exceeding 60 chars - drops everything', () => {
    const anime = {
      name: '短名',
      name_en:
        'This is a Very Long Anime Name That Exceeds Sixty Characters Limit', // 68 chars
      name_ja: 'ショート',
    }
    const posts = [{ city: 'Shimokitazawa' }, { city: 'Enoshima' }]

    const result = buildAnimeSeoTitle(anime, posts, 'en')

    // Name alone is 68 chars, exceeds 60
    // Even titleWithoutCities would exceed 60
    // Should return name only
    expect(result.absolute).toBe(
      'This is a Very Long Anime Name That Exceeds Sixty Characters Limit'
    )
  })

  it('handles very long EN anime name exceeding 60 chars even without cities - drops keyword', () => {
    const anime = {
      name: '短名',
      name_en:
        'This is an Extremely Long Anime Name That Exceeds Sixty Characters Even Without Any Additional Suffix',
      name_ja: 'ショート',
    }
    const posts = []

    const result = buildAnimeSeoTitle(anime, posts, 'en')

    // Should drop keyword suffix entirely
    expect(result.absolute).toBe(
      'This is an Extremely Long Anime Name That Exceeds Sixty Characters Even Without Any Additional Suffix'
    )
  })

  it('handles empty posts array - generates title without cities', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts: Array<{ city?: string | null }> = []

    const resultZh = buildAnimeSeoTitle(anime, posts, 'zh')
    const resultEn = buildAnimeSeoTitle(anime, posts, 'en')
    const resultJa = buildAnimeSeoTitle(anime, posts, 'ja')

    expect(resultZh).toEqual({ absolute: '孤独摇滚 圣地巡礼攻略' })
    expect(resultEn).toEqual({ absolute: 'Bocchi the Rock! Anime Pilgrimage Guide' })
    expect(resultJa).toEqual({ absolute: 'ぼっち・ざ・ろっく 聖地巡礼ガイド' })
  })

  it('handles posts with null/empty cities', () => {
    const anime = {
      name: '孤独摇滚',
      name_en: 'Bocchi the Rock!',
      name_ja: 'ぼっち・ざ・ろっく',
    }
    const posts = [
      { city: null },
      { city: '' },
      { city: '  ' },
      { city: '下北泽' },
    ]

    const result = buildAnimeSeoTitle(anime, posts, 'zh')

    expect(result).toEqual({ absolute: '孤独摇滚 圣地巡礼攻略｜下北泽' })
  })
})

describe('buildCitySeoTitle', () => {
  it('builds normal ZH city title with anime names', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames = ['孤独摇滚', '某科学的超电磁炮']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'zh')

    expect(result).toEqual({
      absolute: '下北泽 动漫圣地巡礼｜孤独摇滚·某科学的超电磁炮',
    })
  })

  it('builds normal EN city title with anime names', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames = ['Bocchi the Rock!', 'A Certain Scientific Railgun']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'en')

    // Full title is 79 chars, exceeds 60, so anime names are dropped
    expect(result.absolute).toBe('Shimokitazawa Anime Pilgrimage')
  })

  it('builds normal JA city title with anime names', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames = ['ぼっち・ざ・ろっく', 'とある科学の超電磁砲']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'ja')

    // Full title is 32 chars, exceeds 30, so anime names are dropped
    expect(result.absolute).toBe('下北沢 アニメ聖地巡礼')
  })

  it('handles null name_en - falls back to name_zh', () => {
    const city = {
      name_zh: '下北泽',
      name_en: null,
      name_ja: '下北沢',
    }
    const relatedAnimeNames = ['Bocchi the Rock!']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'en')

    // Should use Chinese name with English keyword
    expect(result).toEqual({
      absolute: '下北泽 Anime Pilgrimage | Bocchi the Rock!',
    })
  })

  it('handles undefined name_ja - falls back to name_zh', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
    }
    const relatedAnimeNames = ['ぼっち・ざ・ろっく']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'ja')

    expect(result).toEqual({
      absolute: '下北泽 アニメ聖地巡礼｜ぼっち・ざ・ろっく',
    })
  })

  it('handles empty related anime names array', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames: string[] = []

    const resultZh = buildCitySeoTitle(city, relatedAnimeNames, 'zh')
    const resultEn = buildCitySeoTitle(city, relatedAnimeNames, 'en')
    const resultJa = buildCitySeoTitle(city, relatedAnimeNames, 'ja')

    expect(resultZh).toEqual({ absolute: '下北泽 动漫圣地巡礼' })
    expect(resultEn).toEqual({ absolute: 'Shimokitazawa Anime Pilgrimage' })
    expect(resultJa).toEqual({ absolute: '下北沢 アニメ聖地巡礼' })
  })

  it('handles more than 2 anime names - takes first 2', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames = [
      '孤独摇滚',
      '某科学的超电磁炮',
      '第三个动画',
      '第四个动画',
    ]

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'zh')

    expect(result).toEqual({
      absolute: '下北泽 动漫圣地巡礼｜孤独摇滚·某科学的超电磁炮',
    })
  })

  it('handles duplicate anime names - deduplicates', () => {
    const city = {
      name_zh: '下北泽',
      name_en: 'Shimokitazawa',
      name_ja: '下北沢',
    }
    const relatedAnimeNames = ['孤独摇滚', '孤独摇滚', '某科学的超电磁炮']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'zh')

    expect(result).toEqual({
      absolute: '下北泽 动漫圣地巡礼｜孤独摇滚·某科学的超电磁炮',
    })
  })

  it('handles long city title exceeding 30 chars (ZH) - truncates anime first', () => {
    const city = {
      name_zh: '非常长的城市名字',
      name_en: 'Short',
      name_ja: 'ショート',
    }
    const relatedAnimeNames = [
      '这是一个非常非常长的动画名字',
      '另一个长动画名字',
    ]

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'zh')

    // Should drop anime suffix first
    expect(result.absolute).toBe('非常长的城市名字 动漫圣地巡礼')
  })

  it('handles very long city name exceeding 30 chars even with keyword (ZH) - drops keyword', () => {
    const city = {
      name_zh: '这是一个超级超级超级超级超级超级长的城市名字', // 24 chars
      name_en: 'Short',
      name_ja: 'ショート',
    }
    const relatedAnimeNames = ['动画']

    const result = buildCitySeoTitle(city, relatedAnimeNames, 'zh')

    // Name (24) + ' 动漫圣地巡礼' (7) = 31 chars, exceeds 30
    // Actual string '这是一个超级超级超级超级超级超级长的城市名字 动漫圣地巡礼' is 29 chars, fits!
    expect(result.absolute).toBe('这是一个超级超级超级超级超级超级长的城市名字 动漫圣地巡礼')
  })
})

describe('buildPostFallbackTitle', () => {
  it('builds ZH post title with city', () => {
    const result = buildPostFallbackTitle('下北泽车站前', 'anime-id', '下北泽', 'zh')

    expect(result).toEqual({
      absolute: '下北泽车站前 圣地巡礼｜下北泽',
    })
  })

  it('builds EN post title with city', () => {
    const result = buildPostFallbackTitle(
      'Shimokitazawa Station',
      'anime-id',
      'Shimokitazawa',
      'en'
    )

    expect(result).toEqual({
      absolute: 'Shimokitazawa Station Anime Pilgrimage | Shimokitazawa',
    })
  })

  it('builds JA post title with city', () => {
    const result = buildPostFallbackTitle('下北沢駅前', 'anime-id', '下北沢', 'ja')

    expect(result).toEqual({
      absolute: '下北沢駅前 聖地巡礼｜下北沢',
    })
  })

  it('builds ZH post title without city', () => {
    const result = buildPostFallbackTitle('某个地点', 'anime-id', null, 'zh')

    expect(result).toEqual({
      absolute: '某个地点 圣地巡礼',
    })
  })

  it('builds EN post title without city', () => {
    const result = buildPostFallbackTitle('Some Location', 'anime-id', undefined, 'en')

    expect(result).toEqual({
      absolute: 'Some Location Anime Pilgrimage',
    })
  })

  it('builds JA post title without city', () => {
    const result = buildPostFallbackTitle('ある場所', null, null, 'ja')

    expect(result).toEqual({
      absolute: 'ある場所 聖地巡礼',
    })
  })

  it('handles empty city string', () => {
    const result = buildPostFallbackTitle('地点', 'anime-id', '  ', 'zh')

    expect(result).toEqual({
      absolute: '地点 圣地巡礼',
    })
  })

  it('handles long post title that fits within 30 chars with city (ZH)', () => {
    const result = buildPostFallbackTitle(
      '这是一个非常长的帖子标题', // 13 chars
      'anime-id',
      '城市名',
      'zh'
    )

    // Title (13) + ' 圣地巡礼｜' (6) + city (3) = 22 chars, does NOT exceed 30
    // Should keep full title with city
    expect(result.absolute).toBe('这是一个非常长的帖子标题 圣地巡礼｜城市名')
  })

  it('handles very long post title that fits with keyword (ZH)', () => {
    const result = buildPostFallbackTitle(
      '这是一个超级超级超级超级超级超级长的帖子标题', // 24 chars
      'anime-id',
      null,
      'zh'
    )

    // Title (24) + ' 圣地巡礼' (5) = 29 chars, does NOT exceed 30
    // Should keep keyword
    expect(result.absolute).toBe('这是一个超级超级超级超级超级超级长的帖子标题 圣地巡礼')
  })

  it('handles long EN post title exceeding 60 chars - drops everything', () => {
    const result = buildPostFallbackTitle(
      'This is a Very Long Post Title That Exceeds Sixty Characters', // 62 chars
      'anime-id',
      'City',
      'en'
    )

    // Title alone is 62 chars, exceeds 60
    // Should return title only
    expect(result.absolute).toBe(
      'This is a Very Long Post Title That Exceeds Sixty Characters'
    )
  })

  it('handles very long EN post title exceeding 60 chars even without city - drops keyword', () => {
    const result = buildPostFallbackTitle(
      'This is an Extremely Long Post Title That Exceeds Sixty Characters Even Without Any Additional Suffix',
      null,
      null,
      'en'
    )

    // Should drop keyword suffix entirely
    expect(result.absolute).toBe(
      'This is an Extremely Long Post Title That Exceeds Sixty Characters Even Without Any Additional Suffix'
    )
  })

  it('trims whitespace from title and city', () => {
    const result = buildPostFallbackTitle('  标题  ', 'anime-id', '  城市  ', 'zh')

    expect(result).toEqual({
      absolute: '标题 圣地巡礼｜城市',
    })
  })
})
