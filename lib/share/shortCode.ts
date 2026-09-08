const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export const SHARE_CODE_LENGTH = 8
export const SHARE_CODE_MAX_ATTEMPTS = 3

/** 62 * 4 = 248：>=248 的字节会让取模偏向前 8 个字符，直接丢弃 */
const REJECT_THRESHOLD = 248

function defaultRandomBytes(size: number): Uint8Array {
  const buffer = new Uint8Array(size)
  globalThis.crypto.getRandomValues(buffer)
  return buffer
}

export function generateShareCode(
  randomBytes: (size: number) => Uint8Array = defaultRandomBytes,
): string {
  let out = ''
  while (out.length < SHARE_CODE_LENGTH) {
    const chunk = randomBytes(SHARE_CODE_LENGTH * 2)
    for (const byte of chunk) {
      if (byte >= REJECT_THRESHOLD) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === SHARE_CODE_LENGTH) break
    }
  }
  return out
}

export function isShareCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{8}$/.test(value)
}

function defaultIsConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/**
 * 冲突重试：insert 抛唯一键冲突（Prisma P2002）时换一个码再试，最多 3 次。
 * 第 3 次仍冲突就把最后一个错误抛出去，交给路由层转 500。
 */
export async function allocateShareCode<T>(
  insert: (code: string) => Promise<T>,
  options?: { generate?: () => string; isConflict?: (error: unknown) => boolean },
): Promise<T> {
  const generate = options?.generate ?? (() => generateShareCode())
  const isConflict = options?.isConflict ?? defaultIsConflict
  let lastError: unknown = new Error('share code allocation failed')
  for (let attempt = 0; attempt < SHARE_CODE_MAX_ATTEMPTS; attempt++) {
    try {
      return await insert(generate())
    } catch (error) {
      if (!isConflict(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
