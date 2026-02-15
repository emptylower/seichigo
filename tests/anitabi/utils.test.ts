import { describe, expect, it } from 'vitest'
import { ANITABI_TAB_LABELS, parseTab, parseUserLocation } from '@/lib/anitabi/utils'

describe('anitabi utils', () => {
  it('parses supported map tabs including nearby', () => {
    expect(parseTab('latest')).toBe('latest')
    expect(parseTab('recent')).toBe('recent')
    expect(parseTab('hot')).toBe('hot')
    expect(parseTab('nearby')).toBe('nearby')
  })

  it('falls back to latest when tab is unknown', () => {
    expect(parseTab('foo')).toBe('latest')
    expect(parseTab(null)).toBe('latest')
  })

  it('parses user location from query params', () => {
    const params = new URLSearchParams({ lat: '35.681236', lng: '139.767125' })
    expect(parseUserLocation(params)).toEqual({ lat: 35.681236, lng: 139.767125 })
  })

  it('rejects invalid user location values', () => {
    expect(parseUserLocation(new URLSearchParams({ lat: '91', lng: '139' }))).toBeNull()
    expect(parseUserLocation(new URLSearchParams({ lat: '35', lng: '200' }))).toBeNull()
    expect(parseUserLocation(new URLSearchParams({ lat: 'x', lng: '139' }))).toBeNull()
    expect(parseUserLocation(new URLSearchParams({ lat: '35' }))).toBeNull()
  })

  it('contains nearby labels for all locales', () => {
    expect(ANITABI_TAB_LABELS.zh.nearby).toBeTruthy()
    expect(ANITABI_TAB_LABELS.en.nearby).toBeTruthy()
    expect(ANITABI_TAB_LABELS.ja.nearby).toBeTruthy()
  })
})
