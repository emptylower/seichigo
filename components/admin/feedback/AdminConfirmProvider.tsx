'use client'

import { useCallback, useRef, useState } from 'react'
import { ConfirmActionDialog } from '@/components/admin/feedback/ConfirmActionDialog'
import { AdminConfirmContext, type AdminConfirmOptions } from '@/hooks/useAdminConfirm'

type PendingRequest = AdminConfirmOptions

export function AdminConfirmProvider({ children }: { children: React.ReactNode }) {
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null)
  const [request, setRequest] = useState<PendingRequest | null>(null)

  const closeWith = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    if (resolve) resolve(accepted)
  }, [])

  const confirm = useCallback((options: AdminConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false)
      }
      resolverRef.current = resolve
      setRequest(options)
    })
  }, [])

  return (
    <AdminConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmActionDialog
        open={Boolean(request)}
        title={request?.title || ''}
        description={request?.description}
        confirmLabel={request?.confirmLabel}
        cancelLabel={request?.cancelLabel}
        tone={request?.tone || 'default'}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeWith(false)
        }}
        onConfirm={() => closeWith(true)}
      />
    </AdminConfirmContext.Provider>
  )
}
