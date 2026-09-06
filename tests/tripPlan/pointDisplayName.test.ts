import { describe, expect, it } from 'vitest'
import { pointDisplayName } from '@/lib/tripPlan/pointDisplayName'

const point = {
  name: '聖地の駅',
  nameZh: '圣地车站',
  nameEn: 'Seichi Station',
}

describe('pointDisplayName', () => {
  it('zh prefers nameZh when present', () => {
    expect(pointDisplayName(point, 'zh')).toBe('圣地车站')
  })

  it('zh falls back to name without nameZh', () => {
    expect(pointDisplayName({ name: '聖地の駅', nameZh: null, nameEn: null }, 'zh')).toBe('聖地の駅')
  })

  it('zh treats empty nameZh as missing', () => {
    expect(pointDisplayName({ name: '聖地の駅', nameZh: '', nameEn: null }, 'zh')).toBe('聖地の駅')
  })

  it('ja always uses the original name', () => {
    expect(pointDisplayName(point, 'ja')).toBe('聖地の駅')
  })

  it('en prefers nameEn when present', () => {
    expect(pointDisplayName(point, 'en')).toBe('Seichi Station')
  })

  it('en falls back to name without nameEn', () => {
    expect(pointDisplayName({ name: '聖地の駅', nameZh: '圣地车站', nameEn: null }, 'en')).toBe('聖地の駅')
  })

  it('en treats empty nameEn as missing', () => {
    expect(pointDisplayName({ name: '聖地の駅', nameZh: '圣地车站', nameEn: '' }, 'en')).toBe('聖地の駅')
  })

  it('tolerates points without optional fields at all', () => {
    expect(pointDisplayName({ name: ' Kyoto Station ' }, 'zh')).toBe(' Kyoto Station ')
  })
})
