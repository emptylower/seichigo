import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const signInMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}))

import LoginModal from '@/components/auth/LoginModal'
import { t } from '@/lib/i18n'

describe('LoginModal（游客发第一条消息时的登录弹窗）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    signInMock.mockReset()
    signInMock.mockResolvedValue({ ok: true, url: null })
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, cooldownSeconds: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
  })

  it('open=false 时不渲染', () => {
    const { container } = render(<LoginModal open={false} onClose={() => {}} onSuccess={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('走验证码流程：POST /api/auth/request-code → signIn(email-code) → onSuccess', async () => {
    const onSuccess = vi.fn()
    render(<LoginModal open onClose={() => {}} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText(t('auth.modal.email', 'zh')), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.signin.sendCode', 'zh') }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/request-code')
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ email: 'user@example.com', locale: 'zh' })
    expect(await screen.findByText(t('auth.signin.codeSent', 'zh'))).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('auth.modal.code', 'zh')), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.modal.submit', 'zh') }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signInMock).toHaveBeenCalledWith('email-code', {
      email: 'user@example.com',
      code: '123456',
      redirect: false,
    })
  })

  it.each(['en', 'ja'] as const)('发码与提示跟随 %s，成功仍在弹窗回调', async (locale) => {
    const onSuccess = vi.fn()
    render(<LoginModal open locale={locale} onClose={() => {}} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByLabelText(t('auth.modal.email', locale)), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.signin.sendCode', locale) }))
    expect(await screen.findByText(t('auth.signin.codeSent', locale))).toBeInTheDocument()
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ email: 'user@example.com', locale })
    expect(screen.getByRole('button', { name: t('auth.signin.resend', locale).replace('{seconds}', '60') })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(t('auth.modal.code', locale)), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.modal.submit', locale) }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(signInMock).toHaveBeenCalledWith('email-code', { email: 'user@example.com', code: '123456', redirect: false })
  })

  it('验证码错误时留在弹窗并提示，不回调 onSuccess', async () => {
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' })
    const onSuccess = vi.fn()
    render(<LoginModal open onClose={() => {}} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText(t('auth.modal.email', 'zh')), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(t('auth.modal.code', 'zh')), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: t('auth.modal.submit', 'zh') }))

    expect(await screen.findByText(t('auth.signin.invalidCode', 'zh'))).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('低-6：locale 决定弹窗文案（默认 zh）', () => {
    const en = render(<LoginModal open locale="en" onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByRole('dialog', { name: t('auth.modal.title', 'en') })).toBeInTheDocument()
    expect(screen.getByLabelText(t('auth.modal.email', 'en'))).toBeInTheDocument()
    en.unmount()

    render(<LoginModal open onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByRole('dialog', { name: t('auth.modal.title', 'zh') })).toBeInTheDocument()
  })

  it('中-7：打开即把焦点送进邮箱框，并有 aria-modal / aria-labelledby', () => {
    render(<LoginModal open onClose={() => {}} onSuccess={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: t('auth.modal.title', 'zh') })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(screen.getByLabelText(t('auth.modal.email', 'zh')))
  })

  it('中-7：Esc 关闭', () => {
    const onClose = vi.fn()
    render(<LoginModal open onClose={onClose} onSuccess={() => {}} />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('中-7：点遮罩关闭，点弹窗内部不关闭', () => {
    const onClose = vi.fn()
    render(<LoginModal open onClose={onClose} onSuccess={() => {}} />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('login-modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('中-7：焦点陷阱——Tab 到末尾回到开头，Shift+Tab 反向', () => {
    render(<LoginModal open onClose={() => {}} onSuccess={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!

    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('关闭按钮回调 onClose', () => {
    const onClose = vi.fn()
    render(<LoginModal open onClose={onClose} onSuccess={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: t('auth.modal.close', 'zh') }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
