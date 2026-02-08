'use client'

type AdminEmptyStateProps = {
  title: string
  description?: string
  action?: React.ReactNode
}

export function AdminEmptyState({ title, description, action }: AdminEmptyStateProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-6 py-10 text-center">
      <div className="text-base font-semibold text-gray-900">{title}</div>
      {description ? <p className="mt-2 text-sm text-gray-600">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}
