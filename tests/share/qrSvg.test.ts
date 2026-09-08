import { describe, expect, it } from 'vitest'
import { buildQrSvg } from '@/lib/share/qrSvg'

const URL = 'https://seichigo.com/map?b=101&p=101%3Asuga&utm_source=share'

describe('buildQrSvg', () => {
  const svg = buildQrSvg(URL)

  it('输出一个自带 viewBox 的 svg 元素', () => {
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('viewBox="0 0')
    expect(svg).toContain('</svg>')
  })

  it('margin 为 0：viewBox 边长等于模块数', () => {
    const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(match![2])
    // 版本 1 是 21，URL 这个长度至少要到版本 3（29）以上
    expect(Number(match![1])).toBeGreaterThanOrEqual(29)
  })

  it('没有固定 width/height，交给 CSS 撑满容器', () => {
    expect(svg).not.toContain('width="')
    expect(svg).not.toContain('height="')
  })

  it('用深色前景与白色背景', () => {
    expect(svg).toContain('#111827')
    expect(svg).toContain('#ffffff')
  })

  it('同一内容两次生成完全一致', () => {
    expect(buildQrSvg(URL)).toBe(svg)
  })

  it('空串返回空串，不抛', () => {
    expect(buildQrSvg('')).toBe('')
  })
})
