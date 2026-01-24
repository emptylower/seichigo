'use client'

import { useCallback, useMemo, useState } from 'react'

type Props = {
  path: string
  label: string
  className?: string
}

export default function CopyLinkButton({ path, label, className }: Props) {
  const [copied, setCopied] = useState(false)

  const url = useMemo(() => {
    const raw = String(path || '').trim()
    if (!raw) return ''
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return origin ? `${origin}${raw.startsWith('/') ? raw : `/${raw}`}` : raw
  }, [path])

  const onClick = useCallback(async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore
    }
  }, [url])

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ||
        'inline-flex items-center justify-center rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'
      }
      aria-label={label}
    >
      {copied ? '已复制' : label}
    </button>
  )
}
