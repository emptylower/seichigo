import { describe, expect, it } from 'vitest'

import { assetCoverSrc, assetCoverSrcSet } from '@/lib/asset/coverSrc'

describe('assetCoverSrc', () => {
  it('相对 /assets/ 路径加 w/q，返回相对路径', () => {
    expect(assetCoverSrc('/assets/abc123', { width: 640 })).toBe('/assets/abc123?w=640&q=75')
  })

  it('绝对 https://seichigo.com/assets/… URL 加 w/q，保持绝对', () => {
    const out = assetCoverSrc('https://seichigo.com/assets/abc123', { width: 640, quality: 78 })
    expect(out).toBe('https://seichigo.com/assets/abc123?w=640&q=78')
  })

  it('显式 quality 覆盖默认 75', () => {
    expect(assetCoverSrc('/assets/a', { width: 320, quality: 60 })).toBe('/assets/a?w=320&q=60')
  })

  it('已有 w/q 不覆盖', () => {
    expect(assetCoverSrc('/assets/a?w=800&q=90', { width: 640 })).toBe('/assets/a?w=800&q=90')
    expect(assetCoverSrc('/assets/a?w=800', { width: 640, quality: 80 })).toBe('/assets/a?w=800&q=80')
  })

  it('保留已有查询参数', () => {
    expect(assetCoverSrc('/assets/a?foo=bar', { width: 640 })).toBe('/assets/a?foo=bar&w=640&q=75')
  })

  it('非 /assets/ URL 原样返回', () => {
    expect(assetCoverSrc('https://img.example.com/x.jpg', { width: 640 })).toBe('https://img.example.com/x.jpg')
    expect(assetCoverSrc('/images/home/hero.webp', { width: 640 })).toBe('/images/home/hero.webp')
  })

  it('空串与非法 URL 原样返回', () => {
    expect(assetCoverSrc('', { width: 640 })).toBe('')
    expect(assetCoverSrc('  ', { width: 640 })).toBe('')
    expect(assetCoverSrc('http://', { width: 640 })).toBe('http://')
  })
})

describe('assetCoverSrcSet', () => {
  it('按宽度列表生成 srcSet 候选串', () => {
    expect(assetCoverSrcSet('/assets/abc', [320, 640, 960])).toBe(
      '/assets/abc?w=320&q=75 320w, /assets/abc?w=640&q=75 640w, /assets/abc?w=960&q=75 960w',
    )
  })

  it('quality 透传到每个候选', () => {
    expect(assetCoverSrcSet('/assets/abc', [320, 640], 60)).toBe(
      '/assets/abc?w=320&q=60 320w, /assets/abc?w=640&q=60 640w',
    )
  })

  it('非 /assets/ URL 返回 undefined（调用方不输出 srcSet 属性）', () => {
    expect(assetCoverSrcSet('https://img.example.com/x.jpg', [320, 640])).toBeUndefined()
    expect(assetCoverSrcSet('/images/home/hero.webp', [320, 640])).toBeUndefined()
    expect(assetCoverSrcSet('', [320, 640])).toBeUndefined()
  })
})
