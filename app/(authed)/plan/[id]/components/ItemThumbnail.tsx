'use client'

import { MapPin } from 'lucide-react'
import ResilientMapImage from '@/components/map/ResilientMapImage'
import { getMapDisplayImageCandidates } from '@/lib/anitabi/imageProxy'
import type { MediaPayload } from './itemPayload'

function Placeholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-100 to-pink-50">
      <MapPin className="h-6 w-6 text-brand-300" />
    </div>
  )
}

/**
 * 高-3：Google Places 照片的可见署名。图底一条极小的说明条（右对齐、单行截断，
 * 完整文案在 title），静态展示与常规模式都渲染——署名是使用条款的一部分，
 * 不能因为"首页只是展示"就省掉。
 */
export function MediaAttribution({ attribution }: { attribution?: string }) {
  if (!attribution) return null
  return (
    <span
      title={attribution}
      className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/45 px-1 py-0.5 text-right text-[9px] leading-tight text-white/95"
    >
      {attribution}
    </span>
  )
}

/**
 * 时间轴条目的方图缩略图：无图 → 渐变占位 + pin 图标；只要有媒体图
 * （payload.media 或 point.image）就渲染——非计序条目（free/参考类 lodging、
 * meal 等）有图也显示，仅计序规则不变；neighbor 来源图右上角加极小"参考"角标
 * （右下角留给署名条）。
 *
 * 点位图复用地图的 ResilientMapImage（直连失败自动走 /api/anitabi/image-render
 * 代理重试）；80–96px 小卡用 point-thumbnail（h160 缩略图变体，R2 已镜像命中率
 * 高），不走 point 的 w=640 档。
 */
/**
 * 静态展示的图片来源：生成时静态化过的 `media.displayUrl` 优先；只有 `point.image`
 * 时换成公开代理 URL（`/api/anitabi/image-render`）——原始站外直链会被 403，而静态
 * `<img>` 没有 ResilientMapImage 的候选梯可以重试，直接就是一张裂图。
 */
function staticImageSrc(image: string | null, media: MediaPayload | null): string | null {
  const fromMedia = String(media?.displayUrl || '').trim()
  if (fromMedia) return fromMedia
  const raw = String(image || '').trim()
  if (!raw) return null
  return getMapDisplayImageCandidates(raw, { kind: 'point-thumbnail' })[0] ?? null
}

export function ItemThumbnail(props: {
  image: string | null
  alt: string
  fallbackSrc: string | null
  media: MediaPayload | null
  /** 静态展示（首页第二屏）：走原生 img，固定宽高、可 eager，首帧直接出图 */
  staticMode?: boolean
  eager?: boolean
}) {
  const { image, alt, fallbackSrc, media, staticMode = false, eager = false } = props
  const staticSrc = staticMode ? staticImageSrc(image, media) : null
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl sm:h-24 sm:w-24">
      {staticMode ? (
        staticSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={staticSrc}
          alt={alt}
          width={96}
          height={96}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
        />
        ) : (
          <Placeholder />
        )
      ) : image ? (
        <ResilientMapImage
          src={image}
          alt={alt}
          kind="point-thumbnail"
          className="h-full w-full object-cover"
          loading="lazy"
          fallbackSrc={fallbackSrc}
          fallback={<Placeholder />}
        />
      ) : (
        <Placeholder />
      )}
      {media?.source === 'neighbor' ? (
        <span
          title="借用邻近条目的图片"
          className="absolute right-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[10px] leading-none text-white/95"
        >
          参考
        </span>
      ) : null}
      <MediaAttribution attribution={media?.attribution} />
    </div>
  )
}
