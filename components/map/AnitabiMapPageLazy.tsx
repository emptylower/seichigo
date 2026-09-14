'use client'

import { createContext, useContext } from 'react'
import dynamic from 'next/dynamic'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBootstrapDTO } from '@/lib/anitabi/types'
import MapPageSkeleton from './MapPageSkeleton'

/**
 * `dynamic()` 的 loading 回调拿不到业务 props（只有 isLoading 等加载态），
 * 所以用模块级 Context 把实际 locale 传进 loading 占位，保证加载前后
 * H1/移动端标题语言一致。`dynamic()` 本体保持模块级，避免 render 内重建动态组件。
 */
const MapLoadingLocaleContext = createContext<SupportedLocale>('zh')

function MapLoadingFallback() {
  const locale = useContext(MapLoadingLocaleContext)
  return <MapPageSkeleton locale={locale} />
}

const AnitabiMapPageClient = dynamic(() => import('./AnitabiMapPageClient'), {
  ssr: false,
  loading: () => <MapLoadingFallback />,
})

export default function AnitabiMapPageLazy({ locale, initialBootstrap }: { locale: SupportedLocale; initialBootstrap?: AnitabiBootstrapDTO }) {
  return (
    <MapLoadingLocaleContext.Provider value={locale}>
      <AnitabiMapPageClient locale={locale} initialBootstrap={initialBootstrap} />
    </MapLoadingLocaleContext.Provider>
  )
}
