import type { ReactNode } from 'react'
import type {
  NavMode,
  RouteBookStatus,
  RouteBookDetail,
  PointRecord,
  PointPreview,
} from '../types'
import { NAV_MODE_LABEL } from '../types'

interface RouteSidebarProps {
  previewEmbedUrl: string | null
  focusPointEmbedUrl: string | null
  focusPoint: PointRecord | null
  focusPreview: PointPreview | null
  routeBook: RouteBookDetail
  sorted: PointRecord[]
  travelMode: NavMode
  setTravelMode: (mode: NavMode) => void
  onCheckIn: (pointId: string) => void
  onStatusChange: (status: RouteBookStatus) => Promise<void>
  hasRouteStops: boolean
  effectiveRouteEmbedUrl: string | null
  checkedCount: number
  allDone: boolean
  nextPoint: PointRecord | null
  children?: ReactNode
}

export function RouteSidebar({
  previewEmbedUrl,
  focusPointEmbedUrl,
  focusPoint,
  focusPreview,
  routeBook,
  sorted,
  travelMode,
  setTravelMode,
  onCheckIn,
  onStatusChange,
  hasRouteStops,
  effectiveRouteEmbedUrl,
  checkedCount,
  allDone,
  nextPoint,
  children,
}: RouteSidebarProps) {
  return (
    <aside className="self-start rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm xl:sticky xl:top-20">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">实时导航预览</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {sorted.length} 个点位
          </span>
        </div>

        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {(['transit', 'driving'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                travelMode === mode
                  ? 'bg-white text-slate-900 shadow'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              onClick={() => setTravelMode(mode)}
            >
              {NAV_MODE_LABEL[mode]}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="relative aspect-[16/9] bg-slate-100">
            {previewEmbedUrl ? (
              <>
                <iframe
                  title={hasRouteStops ? 'Google 路线预览' : 'Google 点位预览'}
                  src={previewEmbedUrl}
                  className="h-full w-full border-0"
                  loading="eager"
                  referrerPolicy="no-referrer-when-downgrade"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/45 px-3 py-2 text-xs font-medium text-white">
                  点击地图查看路线详情
                </div>
              </>
            ) : focusPointEmbedUrl ? (
              <iframe
                title="Google 点位预览"
                src={focusPointEmbedUrl}
                className="h-full w-full border-0"
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-500">
                添加至少 1 个点位后可查看导航预览。
              </div>
            )}
          </div>
          <div className="space-y-1.5 p-3">
            <div className="text-xs font-medium text-slate-500">
              {hasRouteStops
                ? effectiveRouteEmbedUrl
                  ? `Google 真实路线预览（${NAV_MODE_LABEL[travelMode]}）`
                  : `Google 真实路线（${NAV_MODE_LABEL[travelMode]}）`
                : sorted.length === 1
                  ? 'Google 点位页预览'
                  : '路线预览'}
            </div>
            {focusPoint && focusPreview ? (
              <>
                <div className="line-clamp-1 text-sm font-semibold text-slate-900">{focusPreview.title}</div>
                <div className="line-clamp-1 text-xs text-slate-500">{focusPreview.subtitle}</div>
                <div className="truncate text-xs text-slate-500">{focusPoint.pointId}</div>
              </>
            ) : (
              <div className="text-xs text-slate-500">添加点位后会实时更新路线图。</div>
            )}
          </div>
        </div>

        {routeBook.status === 'in_progress' && sorted.length > 0 && (
          <div className={`rounded-xl border p-3 ${
            allDone ? 'border-emerald-200 bg-emerald-50/80' : 'border-sky-200 bg-sky-50/80'
          }`}>
            {allDone ? (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-emerald-700">全部打卡完成</div>
                <div className="text-xs text-emerald-600">{sorted.length}/{sorted.length} 已完成</div>
                <button
                  type="button"
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                  onClick={() => void onStatusChange('completed')}
                >
                  标记为完成巡礼
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-sky-700">
                  巡礼进度 {checkedCount}/{sorted.length}
                </div>
                {nextPoint ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                      onClick={() => onCheckIn(nextPoint.pointId)}
                    >
                      打卡下一站
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
        {children}
      </div>
    </aside>
  )
}
