'use client'

import dynamic from 'next/dynamic'

/**
 * 高-2：地图库（MapLibre ~200 KB）只在真的切到地图 tab 时才进包——列表 tab
 * 是默认视图，首页展示计划更是从不打开地图，没人该为一个没打开的 tab 付费。
 * DayMapExpanded 挂在 DayMap 内部，随之一起延后加载。
 */
export const DayMap = dynamic(() => import('./DayMap').then((mod) => mod.DayMap), {
  ssr: false,
  loading: () => (
    <div className="mx-4 mb-4 flex h-64 items-center justify-center rounded-2xl bg-gray-50 text-xs text-gray-400 sm:h-80">
      地图加载中…
    </div>
  ),
})
