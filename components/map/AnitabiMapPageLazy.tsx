'use client'

import dynamic from 'next/dynamic'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBootstrapDTO } from '@/lib/anitabi/types'
import MapPageSkeleton from './MapPageSkeleton'

const AnitabiMapPageClient = dynamic(() => import('./AnitabiMapPageClient'), {
  ssr: false,
  loading: () => <MapPageSkeleton />,
})

export default function AnitabiMapPageLazy({ locale, initialBootstrap }: { locale: SupportedLocale; initialBootstrap?: AnitabiBootstrapDTO }) {
  return <AnitabiMapPageClient locale={locale} initialBootstrap={initialBootstrap} />
}
