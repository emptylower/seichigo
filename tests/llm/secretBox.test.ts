import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiKeyHintOf, decryptSecret, encryptSecret } from '@/lib/llm/secretBox'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.LLM_PROVIDER_SECRET
  delete process.env.NEXTAUTH_SECRET
  delete process.env.AUTH_SECRET
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('secretBox (AES-256-GCM via Web Crypto)', () => {
  it('round-trips a secret through encrypt/decrypt (v2 HKDF envelope)', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    const box = await encryptSecret('sk-abcdef1234567890')
    expect(box.startsWith('v2.')).toBe(true)
    expect(box.split('.')).toHaveLength(4)
    expect(await decryptSecret(box)).toBe('sk-abcdef1234567890')
  })

  it('still decrypts legacy v1 boxes (sha256 derivation) written before HKDF', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    // 按旧实现手工构造 v1 密文：AES key = sha256(secret)
    const enc = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', enc.encode('unit-test-secret'))
    const key = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode('sk-legacy-key')),
    )
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    const box = `v1.${b64(iv)}.${b64(sealed.subarray(sealed.length - 16))}.${b64(
      sealed.subarray(0, sealed.length - 16),
    )}`
    expect(await decryptSecret(box)).toBe('sk-legacy-key')
  })

  it('v2 keys are HKDF-derived (not the bare sha256 of the secret)', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    const enc = new TextEncoder()
    const box = await encryptSecret('sk-xyz')
    // 用裸 sha256 派生的 key 解 v2 密文必须失败（证明派生路径确实换了）
    const digest = await crypto.subtle.digest('SHA-256', enc.encode('unit-test-secret'))
    const wrongKey = await crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['decrypt'])
    const [ivPart, tagPart, dataPart] = box.split('.').slice(1)
    const iv = Uint8Array.from(atob(ivPart), (c) => c.charCodeAt(0))
    const combined = Uint8Array.from(atob(dataPart) + atob(tagPart), (c) => c.charCodeAt(0))
    await expect(
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrongKey, combined),
    ).rejects.toThrow()
  })

  it('falls back to NEXTAUTH_SECRET then AUTH_SECRET', async () => {
    process.env.NEXTAUTH_SECRET = 'nextauth-secret'
    expect(await decryptSecret(await encryptSecret('sk-key1'))).toBe('sk-key1')

    delete process.env.NEXTAUTH_SECRET
    process.env.AUTH_SECRET = 'auth-secret'
    expect(await decryptSecret(await encryptSecret('sk-key2'))).toBe('sk-key2')
  })

  it('uses a fresh IV per encryption (same plaintext, different boxes, both decryptable)', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    const a = await encryptSecret('same-plaintext')
    const b = await encryptSecret('same-plaintext')
    expect(a).not.toBe(b)
    expect(await decryptSecret(a)).toBe('same-plaintext')
    expect(await decryptSecret(b)).toBe('same-plaintext')
  })

  it('rejects tampered ciphertext instead of returning garbage', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    const box = await encryptSecret('sk-abcdef1234567890')
    const parts = box.split('.')
    // 篡改 data 段（末段）中的一个字符
    const data = parts[3]
    const flipped = (data[0] === 'A' ? 'B' : 'A') + data.slice(1)
    const tampered = [parts[0], parts[1], parts[2], flipped].join('.')
    await expect(decryptSecret(tampered)).rejects.toThrow()
  })

  it('refuses to decrypt with the wrong secret', async () => {
    process.env.LLM_PROVIDER_SECRET = 'secret-one'
    const box = await encryptSecret('sk-abcdef1234567890')
    process.env.LLM_PROVIDER_SECRET = 'secret-two'
    await expect(decryptSecret(box)).rejects.toThrow()
  })

  it('throws a readable error when no secret env is configured', async () => {
    await expect(encryptSecret('sk-x')).rejects.toThrow('LLM_PROVIDER_SECRET 未配置')
    await expect(decryptSecret('v2.A.A.A')).rejects.toThrow('LLM_PROVIDER_SECRET 未配置')
  })

  it('rejects malformed boxes', async () => {
    process.env.LLM_PROVIDER_SECRET = 'unit-test-secret'
    await expect(decryptSecret('not-a-box')).rejects.toThrow()
    await expect(decryptSecret('v2.A.A.A')).rejects.toThrow()
    await expect(decryptSecret('v3.AAAA.AAAA.AAAA')).rejects.toThrow()
  })
})

describe('apiKeyHintOf', () => {
  it('shows first 3 + last 4 chars for keys of length >= 8', () => {
    expect(apiKeyHintOf('sk-abcdefgh1234')).toBe('sk-…1234')
  })

  it('shows only the last 2 chars for short keys', () => {
    expect(apiKeyHintOf('abc')).toBe('…bc')
    expect(apiKeyHintOf('ab')).toBe('…ab')
  })
})
