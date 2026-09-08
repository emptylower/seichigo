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

/**
 * 只信任 Cloudflare 注入的 cf-connecting-ip：x-forwarded-for 客户端可伪造，
 * 匿名限流不能依赖它。缺失（非 CF 入口 / 本地开发）返回 null，由调用方拒绝。
 */
export function readClientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf && cf.trim()) return cf.trim()
  return null
}
