import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import ErrorPage from '@/app/error'

function makeError(overrides: { message?: string; digest?: string; stack?: string } = {}) {
  const error = new Error(overrides.message ?? 'boom: undefined is not an object') as Error & { digest?: string }
  if (overrides.digest) error.digest = overrides.digest
  if (overrides.stack !== undefined) error.stack = overrides.stack
  return error
}

describe('app/error.tsx', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleError.mockRestore()
  })

  it('渲染真实的 error.message 与 digest，而不是 Next 的通用文案', () => {
    render(<ErrorPage error={makeError({ digest: 'abc123' })} reset={() => {}} />)

    expect(screen.getByText('页面出了点问题')).toBeInTheDocument()
    expect(screen.getByTestId('error-message').textContent).toBe('boom: undefined is not an object')
    expect(screen.getByTestId('error-digest').textContent).toContain('abc123')
  })

  it('没有 digest 时不渲染 digest 行', () => {
    render(<ErrorPage error={makeError()} reset={() => {}} />)
    expect(screen.queryByTestId('error-digest')).toBeNull()
  })

  it('message 截到 600 字、stack 截到 1200 字放在 details 里', () => {
    const error = makeError({ message: 'x'.repeat(900), stack: 'y'.repeat(2000) })
    render(<ErrorPage error={error} reset={() => {}} />)

    expect(screen.getByTestId('error-message').textContent!.length).toBe(600)
    const stack = screen.getByTestId('error-stack')
    expect(stack.textContent!.length).toBe(1200)
    expect(stack.closest('details')).not.toBeNull()
  })

  it('点「重试」调用 reset，并给出回首页链接', () => {
    const reset = vi.fn()
    render(<ErrorPage error={makeError()} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
  })

  it('挂载时把 error 打一次 console.error，方便手机端远程调试抓到', () => {
    const error = makeError()
    render(<ErrorPage error={error} reset={() => {}} />)

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toContain(error)
  })

  it('挂载后渲染环境诊断行：UA、html class、font 数量等（SSR 阶段为空，避免水合差异）', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/126.0',
      configurable: true,
    })
    document.documentElement.lang = 'zh'
    document.documentElement.className = 'translated-ltr'
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'format-detection')
    meta.setAttribute('content', 'telephone=no')
    document.head.appendChild(meta)
    const fonts = [document.createElement('font'), document.createElement('font')]
    fonts.forEach((node) => document.body.appendChild(node))
    const tel = document.createElement('a')
    tel.setAttribute('href', 'tel:110')
    document.body.appendChild(tel)

    try {
      render(<ErrorPage error={makeError()} reset={() => {}} />)

      const diagnostics = screen.getByTestId('error-diagnostics')
      expect(diagnostics.textContent).toContain('CriOS/126.0')
      expect(diagnostics.textContent).toContain('translated-ltr')
      expect(screen.getByTestId('diag-font-count').textContent).toContain('2')
      expect(screen.getByTestId('diag-data-detector-count').textContent).toContain('1')
      expect(screen.getByTestId('diag-format-detection').textContent).toContain('telephone=no')
      expect(screen.getByTestId('diag-href').textContent).toContain(window.location.href)
    } finally {
      meta.remove()
      fonts.forEach((node) => node.remove())
      tel.remove()
      document.documentElement.className = ''
    }
  })
})
