'use client'

import * as Dialog from '@radix-ui/react-dialog'

type ConfirmActionDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onOpenChange: (nextOpen: boolean) => void
  onConfirm: () => void
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'default',
  onOpenChange,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-5 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold text-gray-900">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mt-2 text-sm text-gray-600">{description}</Dialog.Description> : null}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={
                tone === 'danger'
                  ? 'rounded-md bg-rose-600 px-3 py-2 text-sm text-white transition hover:bg-rose-700'
                  : 'rounded-md bg-brand-600 px-3 py-2 text-sm text-white transition hover:bg-brand-700'
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
