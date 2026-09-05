import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import TranslateGuard from '@/components/layout/TranslateGuard'

type GuardWindow = Window & { __seichigoTranslateGuard?: boolean }

/** 每个用例都从「未打补丁」的原型开始，跑完还原，避免污染同文件其它用例 */
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

/** 造一个「被 Google 翻译搬走」的现场：child 已经挂到别的父节点下 */
function movedAway() {
  const parent = document.createElement('div')
  const child = document.createElement('span')
  parent.appendChild(child)
  const thief = document.createElement('font')
  thief.appendChild(child) // 搬走：child.parentNode 变成 thief
  return { parent, child }
}

describe('TranslateGuard（浏览器翻译搬节点后的 DOM 兜底）', () => {
  it('组件本身不渲染任何 UI', () => {
    const { container } = render(<TranslateGuard />)
    expect(container.innerHTML).toBe('')
  })

  it('removeChild：节点已被搬走时不抛错，warn 一次并原样返回该节点', () => {
    render(<TranslateGuard />)
    const { parent, child } = movedAway()

    let returned: Node | undefined
    expect(() => {
      returned = parent.removeChild(child)
    }).not.toThrow()
    expect(returned).toBe(child)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('insertBefore：参照节点已被搬走时不抛错，warn 一次、返回新节点且不插入', () => {
    render(<TranslateGuard />)
    const { parent, child } = movedAway()
    const fresh = document.createElement('em')

    let returned: Node | undefined
    expect(() => {
      returned = parent.insertBefore(fresh, child)
    }).not.toThrow()
    expect(returned).toBe(fresh)
    // 保守做法：不插入，parent 保持空
    expect(parent.contains(fresh)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('正常情况行为不变：removeChild 真的摘掉、insertBefore 真的插到参照节点前', () => {
    render(<TranslateGuard />)

    const parent = document.createElement('div')
    const a = document.createElement('span')
    const b = document.createElement('span')
    parent.append(a, b)

    const fresh = document.createElement('em')
    expect(parent.insertBefore(fresh, b)).toBe(fresh)
    expect([...parent.children]).toEqual([a, fresh, b])

    expect(parent.removeChild(a)).toBe(a)
    expect([...parent.children]).toEqual([fresh, b])

    // referenceNode 为 null 时等价于 append
    const tail = document.createElement('i')
    parent.insertBefore(tail, null)
    expect(parent.lastElementChild).toBe(tail)

    expect(warn).not.toHaveBeenCalled()
  })

  it('只打一次补丁：重复挂载不会层层包裹（window 上留标记）', () => {
    render(<TranslateGuard />)
    const patchedRemove = Node.prototype.removeChild
    const patchedInsert = Node.prototype.insertBefore
    expect((window as GuardWindow).__seichigoTranslateGuard).toBe(true)
    expect(patchedRemove).not.toBe(originalRemoveChild)

    render(<TranslateGuard />)
    expect(Node.prototype.removeChild).toBe(patchedRemove)
    expect(Node.prototype.insertBefore).toBe(patchedInsert)
  })
})
