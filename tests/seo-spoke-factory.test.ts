import { describe, expect, it } from 'vitest'
import { validateGeneratedMdxDoc } from '@/lib/seo/spokeFactory/validate'
import { selectTopicsForGeneration } from '@/lib/seo/spokeFactory/extractCandidates'

describe('seo spoke factory validation', () => {
  it('rejects short content without seo-spoke tag', () => {
    const raw = [
      '---',
      'title: "t"',
      'seoTitle: "s"',
      'description: "d"',
      'slug: "x"',
      'animeId: "your-name"',
      'city: "tokyo"',
      'language: "zh"',
      'tags: ["foo"]',
      'publishDate: "2026-02-06"',
      'status: "published"',
      '---',
      'short',
    ].join('\n')

    const result = validateGeneratedMdxDoc(raw)
    expect(result.valid).toBe(false)
    expect(result.errors.some((x) => x.includes('seo-spoke'))).toBe(true)
    expect(result.errors.some((x) => x.includes('too short'))).toBe(true)
  })
})

describe('seo spoke factory topic selection', () => {
  it('filters existing slug/canonical and low confidence topics', () => {
    const selected = selectTopicsForGeneration(
      [
        {
          canonicalPlaceKey: 'suga-shrine',
          placeName: '须贺神社阶梯',
          animeId: '你的名字',
          city: 'tokyo',
          slugBase: 'suga-shrine-your-name-stairs',
          reason: 'high confidence',
          confidence: 0.9,
          sourcePaths: ['/posts/a'],
        },
        {
          canonicalPlaceKey: 'suga-shrine',
          placeName: '重复候选',
          animeId: '你的名字',
          city: 'tokyo',
          slugBase: 'suga-shrine-your-name-stairs',
          reason: 'duplicate',
          confidence: 0.8,
          sourcePaths: ['/posts/b'],
        },
        {
          canonicalPlaceKey: 'weak',
          placeName: '低置信度',
          animeId: '你的名字',
          city: 'tokyo',
          slugBase: 'weak-place',
          reason: 'weak',
          confidence: 0.2,
          sourcePaths: ['/posts/c'],
        },
      ],
      {
        existingSlugs: new Set(['already-exists']),
        existingCanonicalKeys: new Set(),
      },
      30
    )

    expect(selected.selected).toHaveLength(1)
    expect(selected.skippedExisting).toBe(1)
    expect(selected.skippedLowConfidence).toBe(1)
  })
})

