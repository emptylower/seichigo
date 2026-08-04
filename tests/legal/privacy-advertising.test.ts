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
