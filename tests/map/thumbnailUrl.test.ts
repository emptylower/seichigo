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

  it('returns URL with plan=h160 for anitabi.cn host', () => {
    const input = 'https://anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('returns URL with plan=h160 for subdomain.anitabi.cn host', () => {
    const input = 'https://cdn.anitabi.cn/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://cdn.anitabi.cn/image.jpg?plan=h160')
  })

  it('preserves existing plan param for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('drops w and q params and forces plan for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h160')
  })

  it('preserves plan and drops resize params for anitabi host', () => {
    const input = 'https://anitabi.cn/image.jpg?plan=h320&w=128&q=90'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/image.jpg?plan=h320')
  })

  it('rewrites www.anitabi.cn /images path to image.anitabi.cn', () => {
    const input = 'https://www.anitabi.cn/images/user/0/a.jpg?plan=h160'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/user/0/a.jpg?plan=h160')
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

  it('handles relative URL by converting to absolute anitabi URL', () => {
    const input = '/path/to/image.jpg'
    const result = normalizePointThumbnailUrl(input)
    expect(result).toBe('https://image.anitabi.cn/path/to/image.jpg?plan=h160')
  })
})
