/**
 * 供应商 API key 的静态加密（AES-256-GCM，Web Crypto 实现）。
 *
 * 运行环境同时覆盖 Node（vitest / OpenNext nodejs runtime）与 Workers：
 * `globalThis.crypto.subtle` 在两边都是标准全局，比 node:crypto 的
 * subtle 变体更稳（不依赖 nodejs: 前缀解析）。密文格式
 * `v{N}.<iv b64>.<tag b64>.<data b64>`，版本前缀标识派生方式：
 * - v1（历史）：AES key = sha256(secret)，兼容已入库密文只读解密；
 * - v2（当前）：AES key = HKDF-SHA256(secret, salt, info)，加密只产 v2。
 * salt/info 为固定字符串：把密钥派生与裸摘要区分开，防 length-extension
 * 与跨用途密钥复用。Web Crypto 的 AES-GCM encrypt 输出是
 * ciphertext||tag（tag 固定 16 字节在末尾），这里拆开存放仅为可读性，
 * 解密时再拼回去。
 *
 * 加密密钥 = LLM_PROVIDER_SECRET || NEXTAUTH_SECRET || AUTH_SECRET，
 * 回退链保证已有部署（NextAuth 必配 NEXTAUTH/AUTH_SECRET）无需新配置即可用；
 * 独立配置 LLM_PROVIDER_SECRET 可在轮换 NextAuth secret 时不至于让全部
 * 供应商密文失效。
 */

const IV_LENGTH = 12
const TAG_LENGTH = 16
const HKDF_SALT = 'seichigo-llm-provider'
const HKDF_INFO = 'aes-256-gcm-v1'
const encoder = new TextEncoder()

function getSecret(): string {
  const secret =
    process.env.LLM_PROVIDER_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('LLM_PROVIDER_SECRET 未配置（可回退 NEXTAUTH_SECRET / AUTH_SECRET，均缺失）')
  }
  return secret
}

async function importAesKey(secret: string, version: 'v1' | 'v2'): Promise<CryptoKey> {
  if (version === 'v1') {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
    return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    base,
    256,
  )
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(a.length + b.length))
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export async function encryptSecret(plain: string): Promise<string> {
  // 加密只产 v2（HKDF 派生）
  const key = await importAesKey(getSecret(), 'v2')
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)),
  )
  const data = encrypted.subarray(0, encrypted.length - TAG_LENGTH)
  const tag = encrypted.subarray(encrypted.length - TAG_LENGTH)
  return `v2.${toBase64(iv)}.${toBase64(tag)}.${toBase64(data)}`
}

export async function decryptSecret(box: string): Promise<string> {
  const parts = box.split('.')
  if (parts.length !== 4 || (parts[0] !== 'v1' && parts[0] !== 'v2')) {
    throw new Error('密文格式不合法（期望 v1/v2.<iv>.<tag>.<data>）')
  }
  // v1 密文仍按旧派生解（兼容已入库数据），v2 走 HKDF
  const key = await importAesKey(getSecret(), parts[0] as 'v1' | 'v2')
  const iv = fromBase64(parts[1])
  const ciphertext = concatBytes(fromBase64(parts[3]), fromBase64(parts[2]))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plain)
}

/** key 提示：≥8 位显示前 3 + 后 4，更短的只露尾部 2 位，永不暴露中段。 */
export function apiKeyHintOf(plain: string): string {
  if (plain.length >= 8) return `${plain.slice(0, 3)}…${plain.slice(-4)}`
  return `…${plain.slice(-2)}`
}
