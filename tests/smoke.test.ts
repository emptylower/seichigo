import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/admin'

describe('smoke', () => {
  it('hashPassword and verifyPassword work', () => {
    const password = 'test-password-123'
    const hash = hashPassword(password)
    expect(hash).toMatch(/^scrypt\$/)
    expect(verifyPassword(password, hash)).toBe(true)
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })
})

