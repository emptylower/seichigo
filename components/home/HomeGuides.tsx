import Link from 'next/link'
import { Fragment } from 'react'
import { ArrowRight, CalendarDays, Camera, MapPin, MessageSquareText, Users, type LucideIcon } from 'lucide-react'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { assetCoverSrc, assetCoverSrcSet } from '@/lib/asset/coverSrc'
import type { PublicPostListItem } from '@/lib/posts/types'
import { t } from '@/lib/i18n'

/** 攻略段最多展示的卡片数（3 列 × 2 行） */
const MAX_GUIDE_CARDS = 6

const SELLING_POINTS: Array<{ icon: LucideIcon; titleKey: string; descKey: string }> = [
  { icon: Users, titleKey: 'guidesPoint1Title', descKey: 'guidesPoint1Desc' },
  { icon: MapPin, titleKey: 'guidesPoint2Title', descKey: 'guidesPoint2Desc' },
  { icon: Camera, titleKey: 'guidesPoint3Title', descKey: 'guidesPoint3Desc' },
  { icon: MessageSquareText, titleKey: 'guidesPoint4Title', descKey: 'guidesPoint4Desc' },
]

/** 封面胶囊：「{作品名} · {城市}」；作品名取第一个非 unknown 的 localizedAnimeNames，两者都没有则不显示 */
function guideCapsule(item: PublicPostListItem): string | null {
  const anime = (item.localizedAnimeNames ?? []).filter((name) => name && name !== 'unknown')[0]
  const city = item.localizedCity ?? item.city
  const parts = [anime, city].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** 卡片日期：publishDate ?? publishedAt，统一收成 YYYY-MM-DD；两个都没有就不显示 */
function guideDate(item: PublicPostListItem): string | null {
  const raw = item.publishDate ?? item.publishedAt
  if (!raw) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  return match ? match[1]! : null
}

/** 分段渲染带 {br} 的文本：桌面在 {br} 处固定断行，移动端自然折行（与 HomeShowcasePlan 的 PlanTitle 同法） */
function BreakableText({ text }: { text: string }) {
  const lines = text.split('{br}')
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br className="hidden lg:block" /> : null}
          {line}
        </Fragment>
      ))}
    </>
  )
}

/** 两行大标题：「来自{真实旅行者}的 / 动漫圣地巡礼攻略」，accent 用品牌粉（与 HeroTitle 同一套 {accent} 模板做法） */
function GuidesHeading({ locale }: { locale: SiteLocale }) {
  const [before = '', after = ''] = t('pages.home.v2.guidesHeading', locale).split('{accent}')
  return (
    <h2 className="text-balance text-3xl font-extrabold leading-snug tracking-tight text-gray-900 lg:text-4xl">
      <BreakableText text={before} />
      <span data-guides-accent className="text-brand-600">
        {t('pages.home.v2.guidesHeadingAccent', locale)}
      </span>
      <BreakableText text={after} />
    </h2>
  )
}

function GuideCard({ item }: { item: PublicPostListItem }) {
  const capsule = guideCapsule(item)
  const city = item.localizedCity ?? item.city
  const date = guideDate(item)
  return (
    <Link
      href={item.path}
      className="group flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white no-underline shadow-sm transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-brand-100 to-pink-50">
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetCoverSrc(item.cover, { width: 640 })}
            srcSet={assetCoverSrcSet(item.cover, [320, 640, 960])}
            sizes="(min-width:1024px) 300px, (min-width:768px) 45vw, 100vw"
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : null}
        {capsule ? (
          <span className="absolute left-2.5 top-2.5 max-w-[85%] truncate rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-white backdrop-blur">
            {capsule}
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-2 font-bold leading-snug text-gray-900 group-hover:text-brand-600">{item.title}</h3>
        {city || date ? (
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            {city ? (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{city}</span>
              </span>
            ) : null}
            {date ? (
              <span className="flex shrink-0 items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                {date}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  )
}

/**
 * 第四屏「巡礼攻略」（本轮重做）：左右两栏——左栏卖点区（eyebrow + 大标题 +
 * 四个卖点 + 斜体小字），右栏「查看全部攻略」+ 3×2 攻略卡。
 * PublicPostListItem 没有作者与摘要字段，卡片上只有封面/标题/城市/日期；
 * 所有数量与文案都来自真实数据或 i18n。
 */
export default function HomeGuides({ locale, items }: { locale: SiteLocale; items: PublicPostListItem[] }) {
  if (!items.length) return null
  const cards = items.slice(0, MAX_GUIDE_CARDS)

  return (
    <section>
      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* 左栏：标题与卖点 */}
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-brand-600">
            <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
            {t('pages.home.v2.guidesTitle', locale)}
          </p>
          <div className="mt-3">
            <GuidesHeading locale={locale} />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">{t('pages.home.v2.guidesSubtitle', locale)}</p>
          <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-1">
            {SELLING_POINTS.map((point) => (
              <li key={point.titleKey} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <point.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-gray-900">{t(`pages.home.v2.${point.titleKey}`, locale)}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{t(`pages.home.v2.${point.descKey}`, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm italic text-brand-400">{t('pages.home.v2.guidesFooterNote', locale)}</p>
        </div>

        {/* 右栏：查看全部 + 卡片网格 */}
        <div className="min-w-0">
          <div className="flex justify-end">
            <Link
              href={prefixPath('/posts', locale)}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              {t('pages.home.v2.guidesViewAll', locale)}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {cards.map((item) => (
              <GuideCard key={item.path} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
