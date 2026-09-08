import { SHARE_CARD_SIZES } from '@/lib/share/types'

export type ImageSize = { width: number; height: number }

/** SOF0..SOF15，扣掉 DHT(C4)、JPG(C8)、DAC(CC) */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0)
  return out
}

/**
 * 只走段头，不解码熵编码数据：SOI 之后逐段跳，遇到 SOF 就读
 * precision(1) + height(2) + width(2)。
 */
export function parseJpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4) return null
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    let marker = bytes[offset + 1]!
    // 0xFF 填充字节：连续的 FF 只算一个标记前缀
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1
      marker = bytes[offset + 1]!
    }
    // 无长度字段的独立标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // 到了 SOS/EOI 还没见到 SOF，说明这张图读不出尺寸
    if (marker === 0xda || marker === 0xd9) return null

    const length = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
    if (length < 2) return null

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (offset + 8 >= bytes.length) return null
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += 2 + length
  }
  return null
}

/**
 * RIFF(0-3) size(4-7) WEBP(8-11) fourcc(12-15) chunkSize(16-19) payload(20-)。
 * VP8 有损：同步码 9d 01 2a 之后是两个 14 位小端宽高。
 * VP8L 无损：0x2f 签名之后 4 字节里 14 位宽-1 + 14 位高-1。
 * VP8X 扩展：4 字节标志之后是 3 字节小端的画布宽-1 / 高-1。
 */
export function parseWebpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null
  if (readAscii(bytes, 0, 4) !== 'RIFF') return null
  if (readAscii(bytes, 8, 4) !== 'WEBP') return null
  // RIFF 声明的文件长度必须与实际字节数自洽，防止拿截断/拼接的头部读出伪造尺寸
  const riffSize = (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0
  if (riffSize + 8 !== bytes.length) return null

  const fourcc = readAscii(bytes, 12, 4)

  if (fourcc === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    const width = ((bytes[27]! << 8) | bytes[26]!) & 0x3fff
    const height = ((bytes[29]! << 8) | bytes[28]!) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const bits =
      (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0
    const width = (bits & 0x3fff) + 1
    const height = ((bits >>> 14) & 0x3fff) + 1
    return { width, height }
  }

  if (fourcc === 'VP8X') {
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }

  return null
}

export function parseImageSize(bytes: Uint8Array, contentType: string): ImageSize | null {
  const type = String(contentType || '').trim().toLowerCase()
  if (type === 'image/jpeg' || type === 'image/jpg') return parseJpegSize(bytes)
  if (type === 'image/webp') return parseWebpSize(bytes)
  return null
}

export function isAllowedShareCardSize(size: ImageSize | null): boolean {
  if (!size) return false
  return Object.values(SHARE_CARD_SIZES).some(
    (allowed) => allowed.width === size.width && allowed.height === size.height,
  )
}
