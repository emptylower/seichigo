import { describe, expect, it } from 'vitest'
import { getLegalDocument } from '@/lib/legal/content'

const LOCALES = ['zh', 'en', 'ja'] as const

describe('privacy policy advertising disclosure', () => {
  it.each(LOCALES)('%s privacy policy discloses third-party advertising cookies', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    const text = JSON.stringify(doc)
    expect(text).toMatch(/AdSense/)
    expect(text).toMatch(/myadcenter\.google\.com/)
    expect(text).toMatch(/aboutads\.info/)
    expect(text).toMatch(/optout\.networkadvertising\.org/)
  })

  it.each(LOCALES)('%s privacy policy mentions consent management for EEA', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    expect(JSON.stringify(doc)).toMatch(/TCF|CMP/)
  })

  it.each(LOCALES)('%s privacy section headings are sequentially numbered', (locale) => {
    const doc = getLegalDocument('privacy', locale)
    const numbers = doc.sections.map((section) => Number(section.heading.match(/^(\d+)\./)?.[1]))
    expect(numbers).toEqual(numbers.map((_, index) => index + 1))
  })
})

describe('terms copyright policy', () => {
  it.each(LOCALES)('%s terms sections are sequentially numbered and include takedown policy', (locale) => {
    const doc = getLegalDocument('terms', locale)
    const numbers = doc.sections.map((section) => Number(section.heading.match(/^(\d+)\./)?.[1]))
    expect(numbers).toEqual(numbers.map((_, index) => index + 1))
    expect(JSON.stringify(doc)).toMatch(/下架|takedown|削除依頼/i)
    const takedownSection = doc.sections.find((section) =>
      /版权引用|Copyright Quotation|著作権の引用/.test(section.heading)
    )
    expect(takedownSection?.paragraphs).toHaveLength(1)
    expect(takedownSection?.bullets).toHaveLength(4)
  })
})
