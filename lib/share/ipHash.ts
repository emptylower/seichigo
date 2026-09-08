function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** 当日盐：UTC 日期字符串。跨日自然过期，不需要清理任务 */
export function utcDateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** sha256(ip + 当日 UTC 日期) hex —— 不落原始 IP */
export async function hashIp(ip: string, now: Date = new Date()): Promise<string> {
  const material = `${String(ip || '').trim()}${utcDateStamp(now)}`
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(material),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function readClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf && cf.trim()) return cf.trim()
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded && forwarded.trim()) return forwarded.split(',')[0]!.trim()
  return ''
}
