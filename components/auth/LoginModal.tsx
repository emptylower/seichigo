'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useEmailCodeLogin } from '@/components/auth/useEmailCodeLogin'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'

const inputClass =
  'w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-100'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
const TITLE_ID = 'login-modal-title'

/**
 * 登录弹窗：游客在规划师起始页真正发第一条消息时才弹出。
 * 复用登录页的邮箱验证码流程（useEmailCodeLogin），成功后 onSuccess() 回到
 * 原来的动作——不刷新页面、不丢输入。
 */
export default function LoginModal({
  open,
  onClose,
  onSuccess,
  locale = 'zh',
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  /** 低-6：起始页从 `?locale=` 读到什么就传什么（默认中文） */
  locale?: SiteLocale
}) {
  const login = useEmailCodeLogin()
  const dialogRef = useRef<HTMLDivElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // 中-7：打开时把焦点送进邮箱框——键盘用户不必先 Tab 穿过整页才够得着弹窗
  useEffect(() => {
    if (open) emailRef.current?.focus()
  }, [open])

  if (!open) return null

  // 中-7：Esc 关闭 + 焦点陷阱（Tab 在弹窗内首尾环绕，不会跑回被遮住的页面）
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    if (!focusables?.length) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const result = await login.verifyCode()
    if (result.ok) onSuccess()
  }

  return (
    <div
      data-testid="login-modal-overlay"
      // 遮罩点击关闭：只认打在遮罩本身上的点击，弹窗内部冒泡上来的不算
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={TITLE_ID} className="text-base font-bold text-gray-900">
              {t('auth.modal.title', locale)}
            </h2>
            <p className="mt-1 text-xs text-gray-500">{t('auth.modal.subtitle', locale)}</p>
          </div>
          <button
            type="button"
            aria-label={t('auth.modal.close', locale)}
            onClick={onClose}
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form aria-label={t('auth.modal.title', locale)} onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="login-modal-email" className="block text-sm font-medium text-gray-900">
              {t('auth.modal.email', locale)}
            </label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                id="login-modal-email"
                ref={emailRef}
                className={inputClass}
                type="email"
                value={login.email}
                onChange={(event) => login.setEmail(event.target.value)}
                autoComplete="email"
                required
              />
              <button
                type="button"
                disabled={!login.canSendCode}
                onClick={() => void login.requestCode()}
                className="shrink-0 whitespace-nowrap rounded-md border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {login.sendLabel}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="login-modal-code" className="block text-sm font-medium text-gray-900">
              {t('auth.modal.code', locale)}
            </label>
            <input
              id="login-modal-code"
              className={`${inputClass} mt-1`}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('auth.modal.codePlaceholder', locale)}
              value={login.code}
              onChange={(event) => login.setCode(event.target.value)}
              required
            />
          </div>

          {login.hint ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{login.hint}</div> : null}
          {login.error ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{login.error}</div> : null}

          <button
            type="submit"
            disabled={login.loading === 'email-verify'}
            className="h-11 w-full rounded-md bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {t(login.loading === 'email-verify' ? 'auth.modal.submitting' : 'auth.modal.submit', locale)}
          </button>
        </form>
      </div>
    </div>
  )
}
