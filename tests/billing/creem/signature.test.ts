import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { hmacSha256Hex, verifyCreemSignature } from '@/lib/billing/creem/signature'

/**
 * D2：creem-signature = HMAC-SHA256(secret, rawBody) 的小写 hex；
 * verify 用常量时间比较，大小写不敏感。
 */

const SECRET = 'whsec_test_secret'
const BODY = JSON.stringify({ id: 'evt_1', eventType: 'subscription.paid', created_at: 1728734327355 })

function nodeHmac(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

describe('hmacSha256Hex', () => {
  it('与 Node crypto.createHmac 结果一致（小写 hex）', async () => {
    const expected = nodeHmac(SECRET, BODY)
    await expect(hmacSha256Hex(SECRET, BODY)).resolves.toBe(expected)
    expect(nodeHmac(SECRET, BODY)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('空 body 也可计算', async () => {
    await expect(hmacSha256Hex(SECRET, '')).resolves.toBe(nodeHmac(SECRET, ''))
  })
})

describe('verifyCreemSignature', () => {
  it('正确签名通过', async () => {
    await expect(verifyCreemSignature(BODY, nodeHmac(SECRET, BODY), SECRET)).resolves.toBe(true)
  })

  it('大写 hex 的 header 也通过', async () => {
    const upper = nodeHmac(SECRET, BODY).toUpperCase()
    await expect(verifyCreemSignature(BODY, upper, SECRET)).resolves.toBe(true)
  })

  it('错误签名返回 false', async () => {
    await expect(verifyCreemSignature(BODY, nodeHmac('other-secret', BODY), SECRET)).resolves.toBe(false)
  })

  it('篡改 body 返回 false', async () => {
    await expect(verifyCreemSignature(BODY + 'x', nodeHmac(SECRET, BODY), SECRET)).resolves.toBe(false)
  })

  it('header 为 null 返回 false', async () => {
    await expect(verifyCreemSignature(BODY, null, SECRET)).resolves.toBe(false)
  })

  it('header 为空串返回 false', async () => {
    await expect(verifyCreemSignature(BODY, '', SECRET)).resolves.toBe(false)
  })

  it('长度不等的 header 返回 false', async () => {
    await expect(verifyCreemSignature(BODY, 'abcd', SECRET)).resolves.toBe(false)
  })
})
