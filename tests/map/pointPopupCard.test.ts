import { describe, expect, it } from 'vitest'
import { resolvePointPopupAnchor } from '@/components/map/PointPopupCard'

describe('resolvePointPopupAnchor', () => {
  it('prefers a below-point placement near the top of the map', () => {
    expect(resolvePointPopupAnchor({
      x: 120,
      y: 96,
      viewportWidth: 390,
      viewportHeight: 844,
    })).toMatchObject({
      x: 140,
      y: 96,
      placement: 'bottom',
      tipOffsetX: -20,
    })
  })

  it('clamps wide cards to the viewport and keeps the tip aligned', () => {
    expect(resolvePointPopupAnchor({
      x: 20,
      y: 520,
      viewportWidth: 320,
      viewportHeight: 640,
    })).toMatchObject({
      x: 140,
      y: 520,
      placement: 'top',
      tipOffsetX: -98,
    })
  })
})
