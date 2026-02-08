'use client'

import { X } from 'lucide-react'
import { useAdminToast, type AdminToast } from '@/hooks/useAdminToast'

function toneClass(tone: AdminToast['tone']): string {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  if (tone === 'error') return 'border-rose-200 bg-rose-50 text-rose-900'
  return 'border-slate-200 bg-white text-slate-900'
}

function toneDotClass(tone: AdminToast['tone']): string {
  if (tone === 'success') return 'bg-emerald-500'
  if (tone === 'error') return 'bg-rose-500'
  return 'bg-slate-500'
}

export function AdminToastViewport() {
  const { toasts, dismiss } = useAdminToast()

  if (!toasts.length) return null

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex flex-col gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-96">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-3 py-3 shadow-lg transition ${toneClass(toast.tone)}`}
        >
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${toneDotClass(toast.tone)}`} />
            <div className="min-w-0 flex-1">
              {toast.title ? <div className="text-sm font-semibold">{toast.title}</div> : null}
              <div className="text-sm leading-5">{toast.message}</div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭提示"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
