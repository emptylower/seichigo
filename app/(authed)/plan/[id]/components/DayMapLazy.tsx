'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type { SupportedLocale } from '@/lib/i18n/types'
import { planText } from '../lib/planText'
import type { DayMap as DayMapComponent } from './DayMap'

type DayMapProps = ComponentProps<typeof DayMapComponent>

/**
 * 高-2：地图库（MapLibre ~200 KB）只在真的切到地图 tab 时才进包——列表 tab
 * 是默认视图，首页展示计划更是从不打开地图，没人该为一个没打开的 tab 付费。
 * DayMapExpanded 挂在 DayMap 内部，随之一起延后加载。
 *
 * `dynamic()` 的 loading 占位拿不到 props，所以按 locale 记忆一份（同一语言
 * 内引用稳定，不会因重渲染而重挂载），让"地图加载中…"也跟站点语言走。
 */
function lazyDayMap(locale: SupportedLocale) {
  return dynamic(() => import('./DayMap').then((mod) => mod.DayMap), {
    ssr: false,
    loading: () => (
      <div className="mx-4 mb-4 flex h-64 items-center justify-center rounded-2xl bg-gray-50 text-xs text-gray-400 sm:h-80">
        {planText(locale, 'map.mapLoading')}
      </div>
    ),
  })
}

const CACHE = new Map<SupportedLocale, ReturnType<typeof lazyDayMap>>()

export function DayMap(props: DayMapProps) {
  const locale = props.locale ?? 'zh'
  const Lazy = useMemo(() => {
    const cached = CACHE.get(locale)
    if (cached) return cached
    const created = lazyDayMap(locale)
    CACHE.set(locale, created)
    return created
  }, [locale])
  return <Lazy {...props} />
}
