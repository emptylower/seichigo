import crypto from 'node:crypto'

export const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || '112233'

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return getAdminEmails().includes(normalized)
}

// Password hashing (scrypt) to avoid native deps.
// Stored format: scrypt$<salt_b64>$<hash_b64>
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored?: string | null): boolean {
  if (!stored) return false
  const [method, saltB64, hashB64] = stored.split('$')
  if (method !== 'scrypt' || !saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(password, salt, expected.length)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

