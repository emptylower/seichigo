'use client'

import { useEffect, useRef } from 'react'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

const TITLE_ID = 'checkout-unavailable-title'

/**
 * “订阅暂未开放”弹窗：Creem 审核期间结账开关关闭，点“开通标准版”收到
 * 403 checkout_disabled 时弹出（意向已由后端记录，前端只解释现状）。
 * 无外部依赖的可访问对话框：role=dialog + aria-modal，Esc / 遮罩点击关闭，
 * 打开时焦点落在确认按钮上（弹窗里只有这一个可交互元素）。
 */
export function CheckoutUnavailableDialog(props: { open: boolean; onClose: () => void; locale?: SupportedLocale }) {
  const locale = props.locale ?? 'zh'
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (props.open) confirmRef.current?.focus()
  }, [props.open])

  if (!props.open) return null

  return (
    <div
      data-testid="checkout-unavailable-overlay"
      // 遮罩点击关闭：只认打在遮罩本身上的点击，弹窗内部冒泡上来的不算
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          props.onClose()
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id={TITLE_ID} className="text-base font-bold text-gray-900">
          {t('billing.checkout.unavailable.title', locale)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{t('billing.checkout.unavailable.body', locale)}</p>
        <button
          ref={confirmRef}
          type="button"
          onClick={props.onClose}
          className="mt-4 w-full rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          {t('billing.checkout.unavailable.confirm', locale)}
        </button>
      </div>
    </div>
  )
}
