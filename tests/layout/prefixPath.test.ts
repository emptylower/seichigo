import { describe, it, expect } from 'vitest'
import { prefixPath } from '@/components/layout/prefixPath'

describe('prefixPath', () => {
  it('does not localize /plan for any locale', () => {
    expect(prefixPath('/plan', 'zh')).toBe('/plan')
    expect(prefixPath('/plan', 'en')).toBe('/plan')
    expect(prefixPath('/plan', 'ja')).toBe('/plan')
  })

  it('does not localize nested /plan paths', () => {
    expect(prefixPath('/plan/abc', 'en')).toBe('/plan/abc')
    expect(prefixPath('/plan/abc', 'ja')).toBe('/plan/abc')
  })
})
