import type { HTMLAttributes, ReactNode } from 'react'

export function StitchedBorder({
  children,
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      data-testid="stitched-border"
      className={['border border-dashed border-journal-thread', className].join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
