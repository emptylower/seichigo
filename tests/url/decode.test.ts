import { describe, expect, it } from 'vitest'
import { fullyDecodeURIComponent } from '@/lib/url/decode'

describe('fullyDecodeURIComponent', () => {
  it('returns plain input unchanged', () => {
    expect(fullyDecodeURIComponent('sound-euphonium')).toBe('sound-euphonium')
    expect(fullyDecodeURIComponent('你的名字')).toBe('你的名字')
    expect(fullyDecodeURIComponent('')).toBe('')
  })

  it('decodes single-encoded unicode once', () => {
    expect(fullyDecodeURIComponent('%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97')).toBe('你的名字')
  })

  it('decodes double-encoded unicode to the fixed point', () => {
    expect(fullyDecodeURIComponent('%25E4%25BD%25A0%25E7%259A%2584%25E5%2590%258D%25E5%25AD%2597')).toBe('你的名字')
  })

  it('decodes triple-encoded unicode to the fixed point', () => {
    const once = encodeURIComponent('天气之子')
    const triple = encodeURIComponent(encodeURIComponent(once))
    expect(fullyDecodeURIComponent(triple)).toBe('天气之子')
  })

  it('stops after at most 5 decode passes on pathological input', () => {
    let encoded = '长野'
    for (let i = 0; i < 7; i++) encoded = encodeURIComponent(encoded)
    // 7 layers of encoding, only 5 decodes allowed -> two layers must remain
    expect(fullyDecodeURIComponent(encoded)).toBe(encodeURIComponent(encodeURIComponent('长野')))
  })

  it('returns malformed percent sequences as-is', () => {
    expect(fullyDecodeURIComponent('%zz')).toBe('%zz')
    expect(fullyDecodeURIComponent('100%')).toBe('100%')
    expect(fullyDecodeURIComponent('a%2')).toBe('a%2')
  })

  it('returns input unchanged when any pass would throw on invalid UTF-8', () => {
    // decodeURIComponent rejects the truncated %BD sequence, so the pass aborts
    expect(fullyDecodeURIComponent('%25E4%BD')).toBe('%25E4%BD')
    expect(fullyDecodeURIComponent('%E4%BD')).toBe('%E4%BD')
  })
})
