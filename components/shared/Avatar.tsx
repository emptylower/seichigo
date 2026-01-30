'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { getAvatarGradient } from '@/lib/utils/avatarGradient'

type Props = {
  src?: string | null
  name: string
  size?: number
  className?: string
}

export default function Avatar({ src, name, size = 32, className = '' }: Props) {
  const [imageError, setImageError] = useState(false)

  // Memoize gradient and initial to avoid recalculation on re-renders
  const gradient = useMemo(() => getAvatarGradient(name), [name])
  const initial = useMemo(() => name.slice(0, 1).toUpperCase(), [name])

  const showImage = src && !imageError

  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-full ${className}`}
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
          className="flex h-full w-full items-center justify-center text-white font-medium select-none"
          style={{ background: gradient, fontSize: size * 0.5 }}
        >
          {initial}
        </div>
      )}
    </div>
  )
}
