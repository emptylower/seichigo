import { describe, it, expect } from 'vitest'
import { buildUserStateIndex } from '@/components/map/utils/userStateIndex'

type PointState = {
  pointId: string
  state: 'want_to_go' | 'planned' | 'checked_in'
}

describe('buildUserStateIndex', () => {
  it('builds Map index from meState array', () => {
    const meState: PointState[] = [
      { pointId: 'pt-1', state: 'checked_in' },
      { pointId: 'pt-2', state: 'planned' },
    ]
    const index = buildUserStateIndex(meState)
    expect(index.get('pt-1')).toBe('checked_in')
    expect(index.get('pt-2')).toBe('planned')
  })

  it('returns undefined for missing point', () => {
    const index = buildUserStateIndex([{ pointId: 'pt-1', state: 'checked_in' }])
    expect(index.get('pt-999')).toBeUndefined()
  })

  it('handles empty array', () => {
    const index = buildUserStateIndex([])
    expect(index.size).toBe(0)
  })

  it('handles 50 states efficiently', () => {
    const meState: PointState[] = Array.from({ length: 50 }, (_, i) => ({
      pointId: `pt-${i}`,
      state: 'checked_in' as const,
    }))
    const start = performance.now()
    const index = buildUserStateIndex(meState)
    const duration = performance.now() - start
    expect(duration).toBeLessThan(1)
    expect(index.size).toBe(50)
  })

  it('uses last state when duplicate pointIds exist', () => {
    const meState: PointState[] = [
      { pointId: 'pt-1', state: 'checked_in' },
      { pointId: 'pt-1', state: 'planned' },
    ]
    const index = buildUserStateIndex(meState)
    expect(index.get('pt-1')).toBe('planned')
  })
})
