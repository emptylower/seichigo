'use client'

import { createContext, useContext } from 'react'

export type AdminToastTone = 'success' | 'error' | 'info'

export type AdminToast = {
  id: string
  tone: AdminToastTone
  title: string | null
  message: string
  durationMs: number | null
}

export type ShowAdminToastInput = {
  tone?: AdminToastTone
  title?: string
  message: string
  durationMs?: number | null
}

export type AdminToastApi = {
  toasts: AdminToast[]
  show: (input: ShowAdminToastInput) => string
  success: (message: string, title?: string) => string
  error: (message: string, title?: string) => string
  info: (message: string, title?: string) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const AdminToastContext = createContext<AdminToastApi | null>(null)

export function useAdminToast(): AdminToastApi {
  const ctx = useContext(AdminToastContext)
  if (!ctx) {
    throw new Error('useAdminToast must be used inside <AdminToastProvider>')
  }
  return ctx
}
