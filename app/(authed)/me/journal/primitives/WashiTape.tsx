import type { HTMLAttributes } from 'react'

type Color = 'rose' | 'amber' | 'emerald' | 'indigo' | 'violet'
type Props = HTMLAttributes<HTMLDivElement> & { color?: Color }

const COLOR_MAP: Record<Color, string> = {
  rose: 'rgba(168, 57, 43, %)',
  amber: 'rgba(180, 120, 30, %)',
  emerald: 'rgba(40, 110, 75, %)',
  indigo: 'rgba(45, 62, 80, %)',
  violet: 'rgba(110, 60, 130, %)',
}

export function WashiTape({ color = 'rose', className = '', style, ...rest }: Props) {
  const base = COLOR_MAP[color]
  return (
    <div
      data-testid="washi-tape"
      className={['absolute h-[22px] w-[100px] shadow-sm', className].join(' ')}
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, ${base.replace('%', '0.18')} 0 6px, ${base.replace('%', '0.28')} 6px 12px)`,
        ...style,
      }}
      {...rest}
    />
  )
}
