'use client'

type AdminErrorStateProps = {
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export function AdminErrorState({ message, onRetry, retryLabel = '重试' }: AdminErrorStateProps) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-rose-800">
      <div className="text-sm font-medium">{message}</div>
      {onRetry ? (
        <button
          type="button"
          className="mt-3 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm text-rose-700 transition hover:bg-rose-100"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}
