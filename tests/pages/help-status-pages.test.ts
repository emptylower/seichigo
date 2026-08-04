import { describe, expect, it } from 'vitest'
import { getHelpDocument, getStatusDocument } from '@/lib/help/content'

describe('help & status documents', () => {
  it.each(['zh', 'en', 'ja'] as const)('help doc for %s has contact email and copyright section', (locale) => {
    const doc = getHelpDocument(locale)
    expect(doc.contactEmail).toContain('@')
    expect(doc.sections.length).toBeGreaterThanOrEqual(6)
    const joined = JSON.stringify(doc).toLowerCase()
    expect(joined).toMatch(/copyright|著作権|版权/)
  })

  it.each(['zh', 'en', 'ja'] as const)('status doc for %s declares manual maintenance', (locale) => {
    const doc = getStatusDocument(locale)
    const joined = JSON.stringify(doc)
    expect(joined).toMatch(/人工维护|maintained manually|人手で更新/)
  })
})
