import { describe, it, expect } from 'vitest'
import { prefixPath } from '@/components/layout/prefixPath'

describe('prefixPath', () => {
  it.each(['signin', 'signup', 'set-password'])('认证页 %s 支持三语，callbackUrl 与 hash 原样保留', (page) => {
    const path = `/auth/${page}?callbackUrl=%2Fja%2Fmap%3Fx%3D1#form`
    expect(prefixPath(path, 'zh')).toBe(path)
    expect(prefixPath(path, 'en')).toBe(`/en${path}`)
    expect(prefixPath(path, 'ja')).toBe(`/ja${path}`)
    expect(prefixPath(`/en${path}`, 'ja')).toBe(`/ja${path}`)
    expect(prefixPath(`/ja${path}`, 'zh')).toBe(path)
  })

  it('其他认证路径仍不加语言前缀', () => {
    expect(prefixPath('/auth/change-password', 'en')).toBe('/auth/change-password')
    expect(prefixPath('/auth/signin/child', 'ja')).toBe('/auth/signin/child')
    expect(prefixPath('/auth/signup-extra', 'en')).toBe('/auth/signup-extra')
  })

  it('does not localize /plan for any locale', () => {
    expect(prefixPath('/plan', 'zh')).toBe('/plan')
    expect(prefixPath('/plan', 'en')).toBe('/plan')
    expect(prefixPath('/plan', 'ja')).toBe('/plan')
  })

  it('does not localize nested /plan paths', () => {
    expect(prefixPath('/plan/abc', 'en')).toBe('/plan/abc')
    expect(prefixPath('/plan/abc', 'ja')).toBe('/plan/abc')
  })

  it('/plan/start 是唯一本地化的 /plan 例外（精确匹配）', () => {
    expect(prefixPath('/plan/start', 'zh')).toBe('/plan/start')
    expect(prefixPath('/plan/start', 'en')).toBe('/en/plan/start')
    expect(prefixPath('/plan/start', 'ja')).toBe('/ja/plan/start')
  })

  it('/plan 前缀下其余形态维持不本地化', () => {
    expect(prefixPath('/plan/start-extra', 'en')).toBe('/plan/start-extra')
    expect(prefixPath('/plan/start/child', 'ja')).toBe('/plan/start/child')
    expect(prefixPath('/plan/start-extra', 'zh')).toBe('/plan/start-extra')
  })

  it('判断前剥离 query/hash，输出保留原后缀', () => {
    expect(prefixPath('/plan/start?draft=X', 'ja')).toBe('/ja/plan/start?draft=X')
    expect(prefixPath('/plan/start#form', 'en')).toBe('/en/plan/start#form')
    expect(prefixPath('/plan/start?draft=X', 'zh')).toBe('/plan/start?draft=X')
    // 非 /plan/start 的非本地化路径带 query 也不加前缀
    expect(prefixPath('/plan?x=1', 'en')).toBe('/plan?x=1')
    expect(prefixPath('/plan/abc?x=1', 'ja')).toBe('/plan/abc?x=1')
    // 普通路径带 query 正常加前缀并保留后缀
    expect(prefixPath('/posts?a=1', 'en')).toBe('/en/posts?a=1')
    expect(prefixPath('/map#top', 'ja')).toBe('/ja/map#top')
  })

  it('私有 /plan 与 /plan/[id] 继续使用无语言前缀路径', () => {
    expect(prefixPath('/plan', 'ja')).toBe('/plan')
    expect(prefixPath('/plan/plan-123', 'en')).toBe('/plan/plan-123')
  })

  it('首页与普通路径仍按语言加前缀', () => {
    expect(prefixPath('/', 'zh')).toBe('/')
    expect(prefixPath('/', 'en')).toBe('/en')
    expect(prefixPath('/', 'ja')).toBe('/ja')
    expect(prefixPath('/en', 'ja')).toBe('/ja')
    expect(prefixPath('/ja/posts', 'en')).toBe('/en/posts')
  })
})
