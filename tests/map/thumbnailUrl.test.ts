import { describe, it, expect } from 'vitest'
import { normalizePointThumbnailUrl } from '@/components/map/utils/normalizePointThumbnailUrl'

describe('normalizePointThumbnailUrl', () => {
  it('returns null for null input', () => {
    expect(normalizePointThumbnailUrl(null)).toBe(null)
  })

  it('returns null for undefined input', () => {
    expect(normalizePointThumbnailUrl(undefined)).toBe(null)
  })

  it('returns null for empty string', () => {
    expect(normalizePointThumbnailUrl('')).toBe(null)
    expect(normalizePointThumbnailUrl('   ')).toBe(null)
  })

  it('returns URL with w=64&q=60 for anitabi.cn host', () => {
    const input = 'https://anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://anitabi.cn/image.jpg?w=64&q=60')
  })

  it('returns URL with w=64&q=60 for subdomain.anitabi.cn host', () => {
    const input = 'https://cdn.anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://cdn.anitabi.cn/image.jpg?w=64&q=60')
  })

  it('removes existing plan param and adds w=64&q=60 for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://anitabi.cn/image.jpg?w=64&q=60')
  })

  it('preserves existing w and q params for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://anitabi.cn/image.jpg?w=128&q=90')
  })

  it('returns original URL for non-anitabi host', () => {
    const input = 'https://example.com/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://example.com/image.jpg')
  })

  it('handles invalid URL gracefully by returning original string', () => {
    const input = 'not-a-valid-url'
    const result = normalizePointThumbnailUrl(input)
    // URL constructor with base converts relative paths to absolute
    expect(result).toBe('https://seichigo.com/not-a-valid-url')
  })

  it('handles relative URL by converting to absolute with base', () => {
    const input = '/path/to/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://seichigo.com/path/to/image.jpg')
  })
})
