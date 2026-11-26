import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'font-inter', variable: '--font-inter', style: { fontFamily: 'Inter' } }),
}))

import RootLayout from '@/app/layout'

function childrenOf(element: ReactElement): ReactElement[] {
  const raw = (element.props as { children?: unknown }).children
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return list.filter((node): node is ReactElement => isValidElement(node))
}

describe('app/layout pvuv analytics script', () => {
  it('embeds pvuv tracking script in <head> with defer and expected attributes', () => {
    const tree = RootLayout({ children: <div /> }) as ReactElement
    expect(tree.type).toBe('html')

    const head = childrenOf(tree).find((node) => node.type === 'head')
    expect(head).toBeDefined()

    const scripts = childrenOf(head!).filter((node) => node.type === 'script')
    const pvuvScript = scripts.find(
      (node) => (node.props as Record<string, unknown>).src === 'https://www.pvuv.ai/f.js'
    )
    expect(pvuvScript).toBeDefined()
    expect(pvuvScript!.props).toMatchObject({
      defer: true,
      src: 'https://www.pvuv.ai/f.js',
      'data-site': 'Hy4iEaRn',
      'data-api': 'https://in.pvuv.ai',
    })
  })
})
