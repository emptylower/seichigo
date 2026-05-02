import { describe, expect, it, vi } from 'vitest'
import {
  buildCompleteModeCoverDemandSignature,
  buildCompleteModePointDemandSignature,
  shouldSkipCompleteModeDemandUpdate,
} from '@/features/map/anitabi/completeModeDemand'

describe('completeModeDemand', () => {
  it('builds stable signatures for cover and point demand', () => {
    expect(buildCompleteModeCoverDemandSignature([
      { bangumiId: 1, coverUrl: 'a.jpg' },
      { bangumiId: 2, coverUrl: 'b.jpg' },
    ])).toBe('1:a.jpg|2:b.jpg')

    expect(buildCompleteModePointDemandSignature([
      {
        thumbnailKey: '1:p1',
        pointId: 'p1',
        bangumiId: 1,
        imageUrl: 'a.jpg',
        priority: 5,
        density: null,
      },
    ])).toBe('1:p1:p1:1:a.jpg:5:')
  })

  it('skips duplicate demand when the same signature is already in flight', () => {
    expect(shouldSkipCompleteModeDemandUpdate({
      map: {},
      signature: 'sig-1',
      currentSignature: null,
      inFlightSignature: 'sig-1',
      expectedImageIds: ['thumb-a'],
    })).toBe(true)
  })

  it('skips duplicate demand when the same signature is already satisfied on the map', () => {
    const map = {
      hasImage: vi.fn((id: string) => id === 'thumb-a' || id === 'thumb-b'),
    }
    expect(shouldSkipCompleteModeDemandUpdate({
      map,
      signature: 'sig-1',
      currentSignature: 'sig-1',
      inFlightSignature: null,
      expectedImageIds: ['thumb-a', 'thumb-b'],
    })).toBe(true)
  })

  it('does not skip when the signature changes or expected images are missing', () => {
    const map = {
      hasImage: vi.fn(() => false),
    }
    expect(shouldSkipCompleteModeDemandUpdate({
      map,
      signature: 'sig-2',
      currentSignature: 'sig-1',
      inFlightSignature: null,
      expectedImageIds: ['thumb-a'],
    })).toBe(false)

    expect(shouldSkipCompleteModeDemandUpdate({
      map,
      signature: 'sig-1',
      currentSignature: 'sig-1',
      inFlightSignature: null,
      expectedImageIds: ['thumb-a'],
    })).toBe(false)
  })
})
