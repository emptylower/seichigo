import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  variant?: 'square' | 'round'
  rotate?: 'left' | 'right' | 'none'
}

export function RedSeal({
  children,
  variant = 'square',
  rotate = 'right',
  className = '',
  ...rest
}: Props) {
  const rotationClass =
    rotate === 'left' ? '-rotate-3' : rotate === 'right' ? 'rotate-3' : ''
  const shape =
    variant === 'round' ? 'rounded-full w-16 h-16 grid place-items-center' : 'rounded-sm px-2.5 py-1'

  return (
    <span
      data-testid="red-seal"
      data-variant={variant}
      className={[
        'inline-block bg-gradient-to-br from-journal-seal to-journal-seal-deep',
        'text-journal-paper-card font-journal-serif font-bold tracking-[3px]',
        'shadow-[0_0_0_1px_rgba(168,57,43,0.3),2px_3px_0_rgba(168,57,43,0.15)]',
        shape,
        rotationClass,
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  )
}
