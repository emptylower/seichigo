'use client'

import { ExternalLink, MapPin, Navigation, X } from 'lucide-react'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { getMedia, getSchedule } from './itemPayload'
import { buildPointNavigationUrl } from '../lib/navigationLinks'
import type { TripPlanItemView } from '@/lib/tripPlan/view'

/** Google 街景外链（page-in 全景浮层留到后续轮次，本轮先保证可交付） */
export function buildStreetViewUrl(point: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${point.lat.toFixed(6)},${point.lng.toFixed(6)}`
}

const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50'

/**
 * 地图 marker Popup 里的迷你点位卡（移动端小卡风格，宽 240–280px）：
 * 16:10 封面图 + 标题 + 时间 chip + 一句说明 + 「查看条目 / 导航 / 实景」。
 * 图片阶梯与 DayCards 时间线一致：payload.media → 站内 point.image →
 * /api/google/point-photo 兜底，全部经 ResilientMapImage 的候选梯。
 */
export function DayPointCard(props: {
  /** 与该 marker 对应的行程条目（渲染期时间兜底后的那一份）；快照缺失时为 null */
  item: TripPlanItemView | null
  title: string
  lat: number
  lng: number
  /** 「查看条目」：切回列表、滚动到条目并闪烁高亮环 */
  onShowItem?: () => void
  onClose?: () => void
}) {
  const { item, title, lat, lng, onShowItem, onClose } = props
  const media = item ? getMedia(item) : null
  const pointPhotoSrc = item?.pointId
    ? `/api/google/point-photo?pointId=${encodeURIComponent(item.pointId)}&maxwidth=400`
    : null
  const image = media?.displayUrl ?? item?.point?.image ?? pointPhotoSrc
  const schedule = item ? getSchedule(item) : null
  const description = item?.reason ?? item?.note ?? null

  return (
    <div className="w-[248px] max-w-full sm:w-[264px]">
      <div className="relative">
        {image ? (
          // 16:10 封面：Popup 打开即可见，走 eager（不走列表的 lazy）
          <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-gray-100">
            <ResilientMapImage
              src={image}
              alt={title}
              kind="point-thumbnail"
              className="h-full w-full object-cover"
              loading="eager"
              // L4：主图本身就是 point-photo 兜底时不再重复一档（阶梯去重）
              fallbackSrc={image === pointPhotoSrc ? undefined : pointPhotoSrc}
              fallback={
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
                  <MapPin className="h-6 w-6 text-brand-300" />
                </div>
              }
            />
          </div>
        ) : null}
        {onClose ? (
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/65"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs font-semibold leading-5 text-gray-900">{title}</p>
        {schedule ? (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] tabular-nums text-gray-600">
            {schedule.start}–{schedule.end}
          </span>
        ) : null}
      </div>

      {description ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">{description}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onShowItem ? (
          <button
            type="button"
            onClick={onShowItem}
            className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-brand-500"
          >
            查看条目
          </button>
        ) : null}
        <a href={buildPointNavigationUrl({ lat, lng })} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
          <Navigation className="h-3 w-3" />
          导航
        </a>
        <a href={buildStreetViewUrl({ lat, lng })} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
          <ExternalLink className="h-3 w-3" />
          实景
        </a>
      </div>
    </div>
  )
}
