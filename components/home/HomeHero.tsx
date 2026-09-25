import { preload } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { SiteLocale } from '@/components/layout/SiteShell'
import HeroLaurel from './HeroLaurel'
import HomeEntryCards from './HomeEntryCards'
import HomeHeroBackground from './HomeHeroBackground'
import HomeHeroComposer from './HomeHeroComposer'
import HomeHeroPhone from './HomeHeroPhone'
import HomeWorksTicker from './HomeWorksTicker'
import type { HomeHeroDemoLike } from './heroDemoShape'
import { t } from '@/lib/i18n'

/** 副标题里的点位数取整到万位（en 取整到千位加 k），不要精确数字压住这句话 */
function roundedPoints(points: number | undefined, locale: SiteLocale): string {
  if (!points || points <= 0) return ''
  if (locale === 'en') return `${Math.round(points / 1000)}k`
  return locale === 'ja' ? `${Math.round(points / 10000)}万` : `${Math.round(points / 10000)} 万`
}

/**
 * 标题是带 `{accent}` 的两段式模板（第十四轮）：占位前是普通字重、占位处用品牌色。
 * `<br>` 只在 `lg` 生效——桌面固定断在「，」/「、」/「, 」之后成两行，
 * 移动端仍按容器宽度自然折行。
 */
function HeroTitle({ locale }: { locale: SiteLocale }) {
  const [prefix = '', suffix = ''] = t('pages.home.v2.heroTitle', locale).split('{accent}')
  return (
    <h1 className="text-balance text-2xl font-extrabold leading-snug tracking-tight text-gray-900 sm:text-3xl md:text-4xl lg:text-5xl lg:leading-[1.18]">
      {prefix}
      <br className="hidden lg:block" />
      <span data-hero-accent className="text-brand-600">
        {t('pages.home.v2.heroTitleAccent', locale)}
      </span>
      {suffix}
    </h1>
  )
}

function heroSubtitle(locale: SiteLocale, points: number | undefined): string {
  const raw = t('pages.home.v2.heroSubtitle', locale)
  const rounded = roundedPoints(points, locale)
  // 拿不到 stats 时整句去掉第一小节，而不是把 `{points}` 原样漏到页面上
  if (!rounded) return raw.split(' · ').slice(1).join(' · ')
  return raw.replace('{points}', rounded)
}

/**
 * 首屏：本质是 AI 规划师的输入框，几个元素让它"活"起来——打字机占位、
 * 右栏手机里的规划师演示、整屏插画背景 + 压在插画上的巡礼路线、下方作品名滚动条。
 *
 * 第十三轮起首屏在 `lg` 以上锁一整屏（视口高减页眉）：主体网格垂直居中，
 * 移动端不锁高，按内容流式排。第十四轮把点阵与光斑换成一张插画背景
 * （`HomeHeroBackground`），入口卡改成压在插画上的半透明毛玻璃。
 * 第十六轮把底部那排三张小入口卡撤掉（AI 规划就是主输入框，不再单列），
 * 改在左栏作品滚动条下放两张更大的「巡礼地图 / 巡礼攻略」卡填补左栏空白；
 * 首屏收尾行只剩一句 slogan 与指向第二屏的滚动提示。
 *
 * 数据全部来自页面已有的 HomePortalData（演示计划 / 热门作品），首屏不额外发请求；
 * 所有动效都尊重 `prefers-reduced-motion`。
 */
export default function HomeHero({
  locale,
  points,
  works = [],
  demo,
}: {
  locale: SiteLocale
  points?: number
  works?: string[]
  demo?: HomeHeroDemoLike
}) {
  // 手机演示地图是移动端 LCP 候选；背景插画由 HomeHeroBackground 按断点预载。
  if (demo?.map) preload(demo.map.src, { as: 'image', fetchPriority: 'high' })

  const examples = [
    t('pages.home.v2.composerExample1', locale),
    t('pages.home.v2.composerExample2', locale),
    t('pages.home.v2.composerExample3', locale),
  ]

  return (
    <section className="relative flex flex-col overflow-hidden pt-8 lg:min-h-[calc(100svh-var(--site-header-h))]">
      <HomeHeroBackground />

      {/* `grid-cols-1` 不是装饰：默认的 auto 轨道会被作品名滚动条的 max-content 撑到 1100+px，
          首屏通栏后没有外层 max-width 兜底，移动端标题与输入框会被 overflow-hidden 切掉 */}
      <div
        data-hero-main
        className="relative mx-auto my-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10"
      >
        <div className="min-w-0 space-y-4">
          <p className="text-xs font-semibold tracking-wide text-brand-600">{t('pages.home.v2.heroBrandLine', locale)}</p>
          <HeroTitle locale={locale} />
          <p className="max-w-2xl text-sm leading-relaxed text-gray-600">{heroSubtitle(locale, points)}</p>

          <HomeHeroComposer
            locale={locale}
            submitLabel={t('pages.home.v2.composerSubmit', locale)}
            staticPlaceholder={t('pages.home.v2.composerPlaceholder', locale)}
            examples={examples}
          />

          <HomeWorksTicker names={works} label={t('pages.home.v2.heroWorksLabel', locale)} />

          {/* 第十六轮：两张大入口卡（地图 / 攻略）跟在滚动条后面，填补 lg 左栏的纵向空白 */}
          <HomeEntryCards locale={locale} />
        </div>

        <HomeHeroPhone locale={locale} demo={demo} />
      </div>

      {/* 首屏收尾行：一句 slogan + 指向第二屏的滚动提示，让折叠线正好落在这里。
          第十六轮起入口卡挪到左栏滚动条下，不再出现在这里 */}
      <div data-hero-footer className="relative mx-auto mt-auto w-full max-w-5xl px-4 pb-4 pt-5">
        <style>{`
          @keyframes seichigo-hero-scroll-hint {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(4px); }
          }
          .seichigo-hero-scroll-hint { animation: seichigo-hero-scroll-hint 2s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .seichigo-hero-scroll-hint { animation: none; } }
        `}</style>
        {/* 一句 slogan 压在首屏底，两侧各一枝月桂枝：桌面首屏才有，移动端首屏本来就不锁一屏 */}
        <p
          data-hero-slogan
          className="hidden items-center justify-center gap-3 text-center text-sm tracking-wide text-gray-500 lg:flex"
        >
          <HeroLaurel className="shrink-0 text-gray-400" />
          {t('pages.home.v2.heroSlogan', locale)}
          <HeroLaurel className="shrink-0 text-gray-400" mirrored />
        </p>
        <a
          href="#home-showcase"
          aria-label={t('pages.home.v2.heroScrollHint', locale)}
          className="mx-auto mt-3 hidden h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-brand-600 lg:flex"
        >
          <ChevronDown className="seichigo-hero-scroll-hint h-5 w-5" aria-hidden="true" />
        </a>
      </div>
    </section>
  )
}
