import type { ProfileData } from './types'

/**
 * Repository interface for user profile operations.
 */
export interface ProfileRepo {
  /**
   * Get user profile by ID.
   * @returns ProfileData if user exists, null otherwise
   */
  getProfile(userId: string): Promise<ProfileData | null>

  /**
   * Update user profile fields.
   * Only provided fields are updated (partial update).
   * @returns Updated ProfileData
   */
  updateProfile(userId: string, data: Partial<ProfileData>): Promise<ProfileData>
}
