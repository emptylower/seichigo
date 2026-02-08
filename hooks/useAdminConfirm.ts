'use client'

import { createContext, useContext } from 'react'

export type AdminConfirmTone = 'default' | 'danger'

export type AdminConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: AdminConfirmTone
}

export type AdminConfirmApi = (options: AdminConfirmOptions) => Promise<boolean>

export const AdminConfirmContext = createContext<AdminConfirmApi | null>(null)

export function useAdminConfirm(): AdminConfirmApi {
  const ctx = useContext(AdminConfirmContext)
  if (!ctx) {
    throw new Error('useAdminConfirm must be used inside <AdminConfirmProvider>')
  }
  return ctx
}
