import { describe, expect, it } from 'vitest'
import { buildOrganizationJsonLd } from '@/lib/seo/globalJsonLd'
import { getSiteOrigin } from '@/lib/seo/site'

describe('organization json-ld', () => {
  it('sameAs keeps X link and drops any github.com entries', () => {
    const obj = buildOrganizationJsonLd()
    const sameAs = obj.sameAs as string[]

    expect(Array.isArray(sameAs)).toBe(true)
    expect(sameAs).toContain('https://x.com/xixingshu')
    expect(sameAs).not.toContain('https://github.com/seichigo')
    expect(sameAs.some((entry) => entry.includes('github.com'))).toBe(false)
  })

  it('keeps core fields stable', () => {
    const origin = getSiteOrigin()
    const obj = buildOrganizationJsonLd()

    expect(obj['@context']).toBe('https://schema.org')
    expect(obj['@type']).toBe('Organization')
    expect(obj.name).toBe('SeichiGo')
    expect(obj.url).toBe(origin)
    expect(obj.logo).toBe(`${origin}/brand/icons/icon-512.png?v=2`)
  })
})
