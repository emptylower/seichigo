import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLDivElement> & { children: ReactNode }

export function PaperCard({ children, className = '', ...rest }: Props) {
  return (
    <div
      data-testid="paper-card"
      className={[
        'relative bg-journal-paper-card rounded-sm',
        'shadow-[0_1px_0_rgba(31,26,19,0.04),0_8px_24px_-10px_rgba(31,26,19,0.18)]',
        'before:absolute before:inset-0 before:pointer-events-none before:opacity-70',
        className,
      ].join(' ')}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence baseFrequency='0.7' numOctaves='1'/><feColorMatrix values='0 0 0 0 0.6 0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0.05 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
        backgroundBlendMode: 'multiply',
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
