import Link from 'next/link'
import { ArrowRight, BookOpen, Map as MapIcon } from 'lucide-react'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'
import { t } from '@/lib/i18n'

/**
 * 首屏左栏的两张大入口卡（第十六轮）：巡礼地图、巡礼攻略。
 *
 * 第十四轮时它还是首屏底部一排三张小卡（AI 规划 / 地图 / 攻略）。
 * 第十六轮起 AI 规划不再单列（首屏主输入框就是规划入口），剩下两张放大成
 * 约 100px 高的横向卡，挪到左栏 `HomeWorksTicker` 之下，用来填补左栏
 * 在 lg 下的纵向空白；移动端跟在滚动条后面单列排布。
 *
 * 卡片沿用第十四轮的半透明毛玻璃语言压在首屏插画上；右侧装饰
 * （地图卡的世界地图淡化背景 + 圆形 ArrowRight、攻略卡的右缘缩略图条）
 * 全部 `aria-hidden` + 空 `alt`，屏幕阅读器与 SEO 都不可见。
 */
export default function HomeEntryCards({ locale }: { locale: SiteLocale }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* 巡礼地图：右半幅叠一张淡化的世界地图（左缘用 mask 渐出），
          再压一个白色圆形 ArrowRight 按钮 */}
      <Link
        href={prefixPath('/map', locale)}
        // 首屏性能（2026-09-07）：/map、/posts 改为悬停预取，
        // 避免进视口即预取 RSC payload 与 LCP 图抢带宽
        prefetch={false}
        className="relative flex min-h-[104px] items-center gap-4 overflow-hidden rounded-2xl border border-white/60 bg-white/80 p-4 no-underline shadow-sm backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white/95"
      >
        <img
          src="/images/home/map-world.webp"
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 object-cover object-left opacity-30 [mask-image:linear-gradient(to_right,transparent,black_45%)]"
        />
        <MapIcon className="h-8 w-8 shrink-0 text-brand-500" aria-hidden="true" />
        {/* pr-14 给右侧圆形按钮留位，en/ja 长文案在这里折行 */}
        <span className="relative flex min-w-0 flex-1 flex-col gap-1 pr-14">
          <span className="text-base font-semibold text-gray-900">{t('pages.home.v2.entryMapTitle', locale)}</span>
          <span className="text-xs leading-relaxed text-gray-500">{t('pages.home.v2.entryMapDesc', locale)}</span>
        </span>
        <span
          aria-hidden="true"
          className="absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow"
        >
          <ArrowRight className="h-5 w-5 text-brand-500" />
        </span>
      </Link>

      {/* 巡礼攻略：右边缘贴一条上下撑满的缩略图，左缘渐变淡入到卡片底色 */}
      <Link
        href={prefixPath('/posts', locale)}
        prefetch={false}
        className="relative flex min-h-[104px] items-center gap-4 overflow-hidden rounded-2xl border border-white/60 bg-white/80 p-4 no-underline shadow-sm backdrop-blur-sm transition-colors hover:border-brand-300 hover:bg-white/95"
      >
        <img
          src="/images/home/entry-guides.jpg"
          alt=""
          aria-hidden="true"
          loading="lazy"
          width={256}
          height={192}
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-[110px] object-cover [mask-image:linear-gradient(to_right,transparent,black_45%)]"
        />
        <BookOpen className="h-8 w-8 shrink-0 text-brand-500" aria-hidden="true" />
        {/* pr-[126px] = 缩略图 110px + 16px 卡片右内边距，避免文字压住图 */}
        <span className="relative flex min-w-0 flex-1 flex-col gap-1 pr-[126px]">
          <span className="text-base font-semibold text-gray-900">{t('pages.home.v2.entryGuidesTitle', locale)}</span>
          <span className="text-xs leading-relaxed text-gray-500">{t('pages.home.v2.entryGuidesDesc', locale)}</span>
        </span>
      </Link>
    </div>
  )
}
