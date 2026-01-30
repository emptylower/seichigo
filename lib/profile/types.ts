/**
 * Profile data fields from User model.
 * Matches Prisma schema fields: name, image, bio, and 4 social links.
 */
export type ProfileData = {
  name: string | null
  image: string | null
  bio: string | null
  bilibili: string | null
  weibo: string | null
  github: string | null
  twitter: string | null
}
