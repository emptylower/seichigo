import HomeBrowse from '@/components/home/HomeBrowse'
import HomeEntryCards from '@/components/home/HomeEntryCards'
import HomeFaq from '@/components/home/HomeFaq'
import HomeGuides from '@/components/home/HomeGuides'
import HomeHero from '@/components/home/HomeHero'
import HomeMapTeaser from '@/components/home/HomeMapTeaser'
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
 * 顺序＝输入框 → 三个入口 → 展示计划 → 地图预览 → 攻略 → 作品/城市浏览 → FAQ。
 * 各段自成组件，这里只做布局与降级（A 部分数据缺失时对应段不渲染）；
 * 首屏的微演示/点阵/滚动条数据在这里（服务端）从已有数据里派生，客户端不多拿一份。
 */
export default function HomePageTemplate({ locale, data }: { locale: SiteLocale; data: HomePortalData }) {
  return (
    <div className="space-y-12 pb-12 sm:space-y-16">
      {/* 首页专属的 WebSite JSON-LD：把规划师起始页声明成站内搜索入口，与 FAQ JSON-LD 并存 */}
      <PlaceJsonLd data={buildHomeWebSiteJsonLd()} keyPrefix={`home-website-${locale}`} />
      <HomeHero
        locale={locale}
        points={data.stats?.points}
        works={heroWorkNames(data.popularAnime, locale)}
        demo={data.heroDemo}
        dots={data.mapClusters ? { cells: data.mapClusters.cells, bbox: data.mapClusters.bbox } : undefined}
      />
      <HomeEntryCards locale={locale} stats={data.stats} />
      {data.showcase ? <HomeShowcasePlan locale={locale} showcase={data.showcase} /> : null}
      {data.mapClusters ? <HomeMapTeaser locale={locale} clusters={data.mapClusters} /> : null}
      <HomeGuides locale={locale} items={guideItems(data)} />
      <HomeBrowse locale={locale} anime={data.popularAnime} cities={data.popularCities} />
      <HomeFaq locale={locale} />
    </div>
  )
}
