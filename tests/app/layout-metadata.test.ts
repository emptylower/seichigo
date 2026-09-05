import { describe, expect, it, vi } from 'vitest'

// next/font/google 依赖 Next 的 SWC 字体加载器转换，vitest 里直接调用会抛错，用桩替代。
vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'font-inter', variable: '--font-inter', style: { fontFamily: 'Inter' } }),
}))

import { metadata } from '@/app/layout'

describe('app/layout metadata', () => {
  it('关闭 iOS 数据探测器，避免 <a> 注入破坏 React 水合', () => {
    // iOS Safari/WKWebView 会把 09:41、步行 34 分钟 这类文本自动包成 <a>，
    // 改动 React 之外的 DOM，水合时 insertBefore 找不到参照节点报 NotFoundError。
    expect(metadata.formatDetection).toEqual({
      telephone: false,
      date: false,
      address: false,
      email: false,
      url: false,
    })
  })
})
