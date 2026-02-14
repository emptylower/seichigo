'use client'

import dynamic from 'next/dynamic'
import type { SupportedLocale } from '@/lib/i18n/types'
import MapPageSkeleton from './MapPageSkeleton'

const AnitabiMapPageClient = dynamic(() => import('./AnitabiMapPageClient'), {
  ssr: false,
  loading: () => <MapPageSkeleton />,
})

export default function AnitabiMapPageLazy({ locale }: { locale: SupportedLocale }) {
  return <AnitabiMapPageClient locale={locale} />
}
