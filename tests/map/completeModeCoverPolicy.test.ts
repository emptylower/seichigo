import { describe, expect, it } from 'vitest'
import { shouldLoadCompleteModeCovers } from '@/features/map/anitabi/completeModeCoverPolicy'

describe('shouldLoadCompleteModeCovers', () => {
  it('loads covers only when no bangumi detail is active and zoom is below the avatar threshold', () => {
    expect(shouldLoadCompleteModeCovers(null, 12.9)).toBe(true)
    expect(shouldLoadCompleteModeCovers(123, 12.9)).toBe(false)
    expect(shouldLoadCompleteModeCovers(null, 13)).toBe(false)
  })
})
