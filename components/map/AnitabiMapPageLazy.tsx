'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import type { SupportedLocale } from '@/lib/i18n/types'
import MapPageSkeleton from './MapPageSkeleton'

const AnitabiMapPageClient = dynamic(() => import('./AnitabiMapPageClient'), {
  ssr: false,
  loading: () => <MapPageSkeleton />,
})

export default function AnitabiMapPageLazy({ locale }: { locale: SupportedLocale }) {
  const [shouldMountClient, setShouldMountClient] = useState(false)

  useEffect(() => {
    let cancelled = false
    const maybeGlobal = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (id: number) => void
    }

    if (typeof maybeGlobal.requestIdleCallback === 'function') {
      const idleId = maybeGlobal.requestIdleCallback(() => {
        if (cancelled) return
        setShouldMountClient(true)
      }, { timeout: 1200 })
      return () => {
        cancelled = true
        maybeGlobal.cancelIdleCallback?.(idleId)
      }
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return
      setShouldMountClient(true)
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  if (!shouldMountClient) {
    return <MapPageSkeleton />
  }

  return <AnitabiMapPageClient locale={locale} />
}
