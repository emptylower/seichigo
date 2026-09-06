import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

// next/font/google 依赖 Next 的 SWC 字体加载器转换，vitest 里直接调用会抛错，用桩替代。
vi.mock('next/font/google', () => ({
  Inter: () => ({ className: 'font-inter', variable: '--font-inter', style: { fontFamily: 'Inter' } }),
}))

import RootLayout from '@/app/layout'
import TranslateGuard from '@/components/layout/TranslateGuard'

function childrenOf(element: ReactElement): ReactElement[] {
  const raw = (element.props as { children?: unknown }).children
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return list.filter((node): node is ReactElement => isValidElement(node))
}

describe('app/layout 挂 TranslateGuard', () => {
  it('<body> 的第一个子节点就是 TranslateGuard（补丁要早于任何演示组件跑起来）', () => {
    const tree = RootLayout({ children: <div /> }) as ReactElement
    expect(tree.type).toBe('html')

    const body = childrenOf(tree).find((node) => node.type === 'body')
    expect(body).toBeDefined()

    const bodyChildren = childrenOf(body!)
    expect(bodyChildren[0]!.type).toBe(TranslateGuard)
  })
})
