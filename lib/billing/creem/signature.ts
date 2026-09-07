/**
 * Creem webhook 验签（设计 2026-09-06 §2）：
 * header `creem-signature` = HMAC-SHA256(webhookSecret, rawBody) 的小写 hex。
 * 用 WebCrypto 实现（Workers/Node 通用），比较走常量时间。
 */

const encoder = new TextEncoder()

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const bytes = new Uint8Array(signature)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export async function verifyCreemSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (typeof header !== 'string' || header.length === 0) return false
  const expected = await hmacSha256Hex(secret, rawBody)
  const provided = header.trim().toLowerCase()
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
