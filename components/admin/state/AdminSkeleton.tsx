'use client'

import { clsx } from 'clsx'

type AdminSkeletonProps = {
  rows?: number
  className?: string
  compact?: boolean
}

export function AdminSkeleton({ rows = 4, className, compact = false }: AdminSkeletonProps) {
  return (
    <div className={clsx('rounded-xl border border-gray-200 bg-white p-4', className)}>
      <div className={clsx('animate-pulse space-y-3', compact ? 'space-y-2' : 'space-y-3')}>
        {Array.from({ length: Math.max(1, rows) }).map((_, index) => (
          <div
            key={index}
            className={clsx(
              'rounded-md bg-gray-100',
              compact ? 'h-8' : 'h-10',
              index === rows - 1 ? 'w-2/3' : 'w-full'
            )}
          />
        ))}
      </div>
    </div>
  )
}
