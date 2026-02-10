'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { getGradientColors } from '@/lib/utils/avatarGradient'

type Props = {
  src?: string | null
  name: string
  size?: number
  className?: string
}

type Rgb = {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return { r: 255, g: 255, b: 255 }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const normalize = (channel: number) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const [rr, gg, bb] = [normalize(r), normalize(g), normalize(b)]
  return rr * 0.2126 + gg * 0.7152 + bb * 0.0722
}

export default function Avatar({ src, name, size = 32, className = '' }: Props) {
  const [imageError, setImageError] = useState(false)

  const [c1, c2] = useMemo(() => getGradientColors(name), [name])
  const gradient = useMemo(() => `linear-gradient(140deg, ${c1}, ${c2})`, [c1, c2])
  const textColor = useMemo(() => {
    const avgLuminance = (relativeLuminance(hexToRgb(c1)) + relativeLuminance(hexToRgb(c2))) / 2
    return avgLuminance > 0.56 ? '#1f2937' : '#ffffff'
  }, [c1, c2])
  const initial = useMemo(() => name.slice(0, 1).toUpperCase(), [name])

  const showImage = src && !imageError

  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-full ring-1 ring-black/10 shadow-[0_4px_12px_rgba(17,24,39,0.18)] ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name}
    >
      {showImage ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes={`${size}px`}
          className="object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className="flex h-full w-full select-none items-center justify-center font-semibold tracking-[0.02em]"
          style={{ background: gradient, color: textColor, fontSize: Math.max(14, size * 0.5) }}
        >
          {initial}
        </div>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),inset_0_-1px_2px_rgba(15,23,42,0.2)]"
      />
    </div>
  )
}
