import HomeBrowse from '@/components/home/HomeBrowse'
import HomeFaq from '@/components/home/HomeFaq'
import HomeFinalCta from '@/components/home/HomeFinalCta'
import HomeGuides from '@/components/home/HomeGuides'
import HomeHero from '@/components/home/HomeHero'
import HomeMapDatabase from '@/components/home/HomeMapDatabase'
import HomeShowcasePlan from '@/components/home/HomeShowcasePlan'
import { heroWorkNames } from '@/components/home/heroData'
import type { SiteLocale } from '@/components/layout/SiteShell'
import type { HomePortalData } from '@/lib/home/types'
import type { PublicPostListItem } from '@/lib/posts/types'
import { buildHomeWebSiteJsonLd } from '@/lib/seo/globalJsonLd'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'

/** guides 由 getHomePortalData 提供；尚未接上时用 featured + latest 兜底出 6 篇。 */
function guideItems(data: HomePortalData): PublicPostListItem[] {
  if (data.guides) return data.guides
  return [data.featured, ...data.latestShelf].filter((p): p is PublicPostListItem => Boolean(p)).slice(0, 6)
}

/**
 * 首页编排壳（第十二轮）：以规划师为主线、地图与攻略为两翼。
 * 顺序＝输入框 → 三个入口 → 展示计划 → 地图预览 → 攻略 → 作品/城市浏览 → FAQ；
 * 第十三轮起前两段合成一整屏由 `HomeHero` 自己排（入口卡是它的收尾行），
 * 这里不再单独渲染 `HomeEntryCards`，否则入口链接会出现两份。
 *
 * 第十三轮第二批的两处布局约束：
 * 1. 根元素同时带 `data-layout-wide`（外壳 `<main>` 去掉 max-width 与左右内边距）
 *    与 `data-layout-flush`（去掉 `<main>` 顶部内边距），首屏才能真正通栏并紧贴页眉；
 * 2. 根元素自己不再用 `space-y-*`——JSON-LD 的 `<script>` 曾是它的第一个子节点，
 *    `space-y` 把 64px 上边距加到了首屏上。所以 `<script>` 挪到最后，
 *    段间距交给下面那个与上线版本同宽（max-w-5xl + px-4）的容器。
 *
 * 各段自成组件，这里只做布局与降级（A 部分数据缺失时对应段不渲染）；
 * 首屏的演示/滚动条数据在这里（服务端）从已有数据里派生，客户端不多拿一份。
 * 第十四轮首屏背景换成静态插画，不再需要地图网格，所以不再向 `HomeHero` 传 `dots`。
 */
export default function HomePageTemplate({ locale, data }: { locale: SiteLocale; data: HomePortalData }) {
  return (
    <div data-layout-wide="true" data-layout-flush="true" className="pb-12">
      <HomeHero
        locale={locale}
        points={data.stats?.points}
        works={heroWorkNames(data.popularAnime, locale)}
        demo={data.heroDemo}
        stats={data.stats}
      />

      {/* 首屏之外的各段：宽度与上线版本（外壳 max-w-5xl + px-4）完全一致，不因通栏而变宽。
          顺序（第十五轮）：地图数据库（第二屏，带 id="home-showcase" 接住首屏滚动提示）
          → 规划师行程逐天展示（第三屏，id="home-plan"）→ 攻略 → 浏览 → FAQ。
          地图段自己的卡片在 lg 破框到 max-w-6xl（组件内部处理，移动端不溢出）。 */}
      <div data-home-sections className="mx-auto w-full max-w-5xl space-y-12 px-4 pt-20 sm:space-y-16">
        {data.mapClusters ? (
          <HomeMapDatabase locale={locale} clusters={data.mapClusters} stats={data.stats} demo={data.heroDemo} />
        ) : null}
        {data.showcase ? <HomeShowcasePlan locale={locale} showcase={data.showcase} /> : null}
        <HomeGuides locale={locale} items={guideItems(data)} />
        <HomeBrowse locale={locale} anime={data.popularAnime} cities={data.popularCities} />
        <HomeFaq locale={locale} />
        {/* 收尾行动区：FAQ 之后、data-home-sections 容器内最后一段，统计行用真实 stats */}
        <HomeFinalCta locale={locale} stats={data.stats} />
      </div>

      {/* 首页专属的 WebSite JSON-LD：把规划师起始页声明成站内搜索入口，与 FAQ JSON-LD 并存。
          放在最后——它是不可见的 <script>，排在最前会被兄弟间距规则当成"第一段"。 */}
      <PlaceJsonLd data={buildHomeWebSiteJsonLd()} keyPrefix={`home-website-${locale}`} />
    </div>
  )
}
