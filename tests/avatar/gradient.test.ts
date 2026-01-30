import { describe, it, expect } from 'vitest'
import { getAvatarGradient, getGradientColors } from '../../lib/utils/avatarGradient'

describe('avatarGradient', () => {
  describe('getGradientColors', () => {
    it('should return consistent colors for the same name', () => {
      const name = 'test-user'
      const colors1 = getGradientColors(name)
      const colors2 = getGradientColors(name)
      expect(colors1).toEqual(colors2)
    })

    it('should return different colors for different names', () => {
      const colors1 = getGradientColors('user1')
      const colors2 = getGradientColors('user2')
      expect(colors1).not.toEqual(colors2)
    })

    it('should handle empty name', () => {
      const colors = getGradientColors('')
      expect(colors).toHaveLength(2)
      expect(colors[0]).toMatch(/^#[0-9A-F]{6}$/i)
      expect(colors[1]).toMatch(/^#[0-9A-F]{6}$/i)
    })
  })

  describe('getAvatarGradient', () => {
    it('should return a valid linear-gradient string', () => {
      const gradient = getAvatarGradient('test-user')
      expect(gradient).toMatch(/^linear-gradient\(135deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/i)
    })
  })
})
