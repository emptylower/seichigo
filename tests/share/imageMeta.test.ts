import { describe, expect, it } from 'vitest'
import {
  isAllowedShareCardSize,
  parseImageSize,
  parseJpegSize,
  parseWebpSize,
} from '@/lib/share/imageMeta'

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0))
}

/** 最小 JPEG：SOI + 可选 APP0 + SOF0(1200x630) + EOI */
function makeJpeg(width: number, height: number, withApp0: boolean): Uint8Array {
  const app0 = withApp0
    ? [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
    : []
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
  ]
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9])
}

/** 最小有损 WebP：RIFF/WEBP/'VP8 ' + 同步码 9d 01 2a + 14 位宽高 */
function makeWebpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8 '), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes.set([0x00, 0x00, 0x00], 20)
  bytes.set([0x9d, 0x01, 0x2a], 23)
  bytes[26] = width & 0xff
  bytes[27] = (width >> 8) & 0x3f
  bytes[28] = height & 0xff
  bytes[29] = (height >> 8) & 0x3f
  return bytes
}

/** 最小无损 WebP：'VP8L' + 0x2f 签名 + 位域里的 (宽-1)|(高-1)<<14 */
function makeWebpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8L'), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes[20] = 0x2f
  const bits = (width - 1) | ((height - 1) << 14)
  bytes[21] = bits & 0xff
  bytes[22] = (bits >>> 8) & 0xff
  bytes[23] = (bits >>> 16) & 0xff
  bytes[24] = (bits >>> 24) & 0xff
  return bytes
}

/** 最小扩展 WebP：'VP8X' + 4 字节标志 + 3 字节小端的画布宽-1/高-1 */
function makeWebpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(ascii('RIFF'), 0)
  bytes.set([22, 0, 0, 0], 4)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8X'), 12)
  bytes.set([10, 0, 0, 0], 16)
  bytes.set([0x10, 0x00, 0x00, 0x00], 20)
  const w = width - 1
  const h = height - 1
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
  return bytes
}

describe('parseJpegSize', () => {
  it('读 SOF0 的宽高', () => {
    expect(parseJpegSize(makeJpeg(1200, 630, false))).toEqual({ width: 1200, height: 630 })
  })

  it('跳过 APP0 段后仍能读到 SOF0', () => {
    expect(parseJpegSize(makeJpeg(1080, 1440, true))).toEqual({ width: 1080, height: 1440 })
  })

  it('不是 JPEG 返回 null', () => {
    expect(parseJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it('只有 SOI 时返回 null', () => {
    expect(parseJpegSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})

describe('parseWebpSize', () => {
  it('VP8 有损', () => {
    expect(parseWebpSize(makeWebpLossy(1080, 1440))).toEqual({ width: 1080, height: 1440 })
  })

  it('VP8L 无损', () => {
    expect(parseWebpSize(makeWebpLossless(1200, 630))).toEqual({ width: 1200, height: 630 })
  })

  it('VP8X 扩展', () => {
    expect(parseWebpSize(makeWebpExtended(1080, 1440))).toEqual({ width: 1080, height: 1440 })
  })

  it('RIFF 头不对返回 null', () => {
    const broken = makeWebpLossy(1080, 1440)
    broken[0] = 0x00
    expect(parseWebpSize(broken)).toBeNull()
  })
})

describe('parseImageSize / isAllowedShareCardSize', () => {
  it('按 contentType 分派', () => {
    expect(parseImageSize(makeJpeg(1080, 1440, false), 'image/jpeg')).toEqual({ width: 1080, height: 1440 })
    expect(parseImageSize(makeWebpLossy(1200, 630), 'image/webp')).toEqual({ width: 1200, height: 630 })
    expect(parseImageSize(makeJpeg(1080, 1440, false), 'image/png')).toBeNull()
  })

  it('只放行 1080x1440 与 1200x630', () => {
    expect(isAllowedShareCardSize({ width: 1080, height: 1440 })).toBe(true)
    expect(isAllowedShareCardSize({ width: 1200, height: 630 })).toBe(true)
    expect(isAllowedShareCardSize({ width: 1080, height: 1350 })).toBe(false)
    expect(isAllowedShareCardSize(null)).toBe(false)
  })
})
