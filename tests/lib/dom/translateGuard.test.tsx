import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installTranslateGuard } from '@/lib/dom/translateGuard'

type GuardWindow = Window & { __seichigoTranslateGuard?: boolean }

let originalRemoveChild: typeof Node.prototype.removeChild
let originalInsertBefore: typeof Node.prototype.insertBefore
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  originalRemoveChild = Node.prototype.removeChild
  originalInsertBefore = Node.prototype.insertBefore
  delete (window as GuardWindow).__seichigoTranslateGuard
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  Node.prototype.removeChild = originalRemoveChild
  Node.prototype.insertBefore = originalInsertBefore
  delete (window as GuardWindow).__seichigoTranslateGuard
  warn.mockRestore()
})

describe('installTranslateGuard', () => {
  it('第一次装返回 true 并换掉两个原型方法，第二次返回 false 且不再包裹', () => {
    expect(installTranslateGuard()).toBe(true)
    const patched = Node.prototype.removeChild
    expect(patched).not.toBe(originalRemoveChild)
    expect(Node.prototype.insertBefore).not.toBe(originalInsertBefore)

    expect(installTranslateGuard()).toBe(false)
    expect(Node.prototype.removeChild).toBe(patched)
  })

  it('父节点对不上时吞掉两种操作，各 warn 一次', () => {
    installTranslateGuard()

    const parent = document.createElement('div')
    const orphan = document.createElement('span')
    document.createElement('font').appendChild(orphan)

    expect(parent.removeChild(orphan)).toBe(orphan)
    const fresh = document.createElement('em')
    expect(parent.insertBefore(fresh, orphan)).toBe(fresh)
    expect(parent.childNodes).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('文本节点也走同一条兜底（翻译会把文本包进 <font> 再搬走）', () => {
    installTranslateGuard()

    const parent = document.createElement('p')
    const text = document.createTextNode('步行 · 约 8 分钟')
    parent.appendChild(text)
    const font = document.createElement('font')
    font.appendChild(text)

    expect(() => parent.removeChild(text)).not.toThrow()
    expect(() => parent.insertBefore(document.createElement('b'), text)).not.toThrow()
  })
})
