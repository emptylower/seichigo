# SEO 内容端增强 - 技术实现细节

> **创建时间**: 2025-01-19
> **关联计划**: seo-content-enhancement.md

---

## 一、城市 Hub 实现细节

### 1.1 `lib/city/types.ts`

```typescript
export type CityArea = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
}

export type City = {
  id: string
  name_zh: string
  name_en?: string
  name_ja?: string
  description_zh?: string
  description_en?: string
  areas?: CityArea[]
  cover?: string
  transportTips_zh?: string
  transportTips_en?: string
}
```

### 1.2 `lib/city/getAllCities.ts`

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import type { City } from './types'

const CITY_DIR = path.join(process.cwd(), 'content', 'city')

export async function getAllCities(): Promise<City[]> {
  let files: string[] = []
  try {
    files = await fs.readdir(CITY_DIR)
  } catch {
    return []
  }
  
  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  const cities: City[] = []
  
  for (const file of jsonFiles) {
    const full = path.join(CITY_DIR, file)
    const raw = await fs.readFile(full, 'utf-8').catch(() => '{}')
    try {
      const data = JSON.parse(raw) as City
      if (data.id && data.name_zh) {
        cities.push(data)
      }
    } catch {
      // ignore invalid JSON
    }
  }
  
  return cities
}
```

### 1.3 `lib/city/getCityById.ts`

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import type { City } from './types'

const CITY_DIR = path.join(process.cwd(), 'content', 'city')

export async function getCityById(id: string): Promise<City | null> {
  const file = path.join(CITY_DIR, `${id}.json`)
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const data = JSON.parse(raw) as City
    return data.id ? data : null
  } catch {
    return null
  }
}
```

### 1.4 `app/(site)/city/page.tsx` 骨架

```typescript
import { getAllCities } from '@/lib/city/getAllCities'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import CityCard from '@/components/city/CityCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '城市索引',
  description: '按城市浏览圣地巡礼路线，从东京到京都，找到你的目的地。',
  alternates: { canonical: '/city' },
  openGraph: {
    type: 'website',
    url: '/city',
    title: '城市索引',
    description: '按城市浏览圣地巡礼路线...',
  },
}

export const dynamic = 'force-dynamic'

export default async function CityIndexPage() {
  const [cities, posts] = await Promise.all([
    getAllCities(),
    getAllPublicPosts('zh'),
  ])
  
  // 统计每个城市的文章数
  const counts = posts.reduce<Record<string, number>>((acc, p) => {
    const city = p.city || ''
    if (city) acc[city] = (acc[city] || 0) + 1
    return acc
  }, {})
  
  // 按文章数排序
  const sorted = [...cities].sort((a, b) => {
    const ca = counts[a.id] || 0
    const cb = counts[b.id] || 0
    return cb - ca
  })
  
  return (
    <div>
      <h1 className="text-2xl font-bold">城市</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((c) => (
          <CityCard
            key={c.id}
            city={c}
            postCount={counts[c.id] || 0}
          />
        ))}
      </div>
    </div>
  )
}
```

### 1.5 `app/(site)/city/[id]/page.tsx` 骨架

```typescript
import { getCityById } from '@/lib/city/getCityById'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { buildBreadcrumbListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import BookCover from '@/components/bookstore/BookCover'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const city = await getCityById(id)
  if (!city) return { title: '未找到城市', robots: { index: false } }
  
  const siteOrigin = getSiteOrigin()
  return {
    title: city.name_zh,
    description: city.description_zh || `${city.name_zh}圣地巡礼路线汇总`,
    alternates: {
      canonical: `/city/${id}`,
      languages: {
        'zh': `${siteOrigin}/city/${id}`,
        'en': `${siteOrigin}/en/city/${id}`,
      },
    },
    openGraph: {
      type: 'website',
      title: city.name_zh,
      description: city.description_zh,
      url: `/city/${id}`,
    },
  }
}

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const city = await getCityById(id)
  if (!city) return notFound()
  
  const posts = await getAllPublicPosts('zh')
  const cityPosts = posts.filter((p) => p.city === id)
  
  const siteOrigin = getSiteOrigin()
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: '首页', url: `${siteOrigin}/` },
    { name: '城市', url: `${siteOrigin}/city` },
    { name: city.name_zh, url: `${siteOrigin}/city/${id}` },
  ])
  
  // Place JSON-LD
  const placeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: city.name_zh,
    alternateName: [city.name_en, city.name_ja].filter(Boolean),
    description: city.description_zh,
  }
  
  return (
    <>
      {breadcrumbJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(placeJsonLd) }} />
      
      <div className="space-y-8">
        <Breadcrumbs items={[
          { name: '首页', href: '/' },
          { name: '城市', href: '/city' },
          { name: city.name_zh, href: `/city/${id}` },
        ]} />
        
        {/* Hero */}
        <div className="relative rounded-3xl bg-gray-900 text-white p-8">
          {city.cover && (
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-40 blur-xl"
              style={{ backgroundImage: `url(${city.cover})` }}
            />
          )}
          <div className="relative z-10">
            <h1 className="text-4xl font-bold">{city.name_zh}</h1>
            {city.name_ja && <p className="mt-2 text-gray-300">{city.name_ja}</p>}
            {city.description_zh && <p className="mt-4">{city.description_zh}</p>}
          </div>
        </div>
        
        {/* Area Navigation */}
        {city.areas?.length ? (
          <nav className="flex flex-wrap gap-2">
            {city.areas.map((area) => (
              <a key={area.id} href={`#area-${area.id}`} className="px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200">
                {area.name_zh}
              </a>
            ))}
          </nav>
        ) : null}
        
        {/* Posts */}
        <section>
          <h2 className="text-2xl font-bold border-b pb-2">相关路线 ({cityPosts.length})</h2>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cityPosts.map((p) => (
              <Link key={p.path} href={p.path}>
                <BookCover
                  title={p.title}
                  path={p.path}
                  animeIds={p.animeIds}
                  city={p.city}
                  routeLength={p.routeLength}
                  publishDate={p.publishDate}
                  cover={p.cover}
                  variant="shelf"
                />
              </Link>
            ))}
          </div>
        </section>
        
        {/* Transport Tips */}
        {city.transportTips_zh && (
          <section className="rounded-xl bg-blue-50 p-6">
            <h3 className="font-bold text-blue-900">🚃 交通小贴士</h3>
            <p className="mt-2 text-blue-800">{city.transportTips_zh}</p>
          </section>
        )}
      </div>
    </>
  )
}
```

### 1.6 `components/city/CityCard.tsx`

```typescript
import Link from 'next/link'
import type { City } from '@/lib/city/types'

type Props = {
  city: City
  postCount: number
}

export default function CityCard({ city, postCount }: Props) {
  return (
    <Link
      href={`/city/${city.id}`}
      className="group relative overflow-hidden rounded-xl bg-gray-900 aspect-[4/3]"
    >
      {city.cover && (
        <img
          src={city.cover}
          alt={city.name_zh}
          className="absolute inset-0 h-full w-full object-cover opacity-70 transition-transform group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
        <h3 className="text-xl font-bold">{city.name_zh}</h3>
        {city.name_en && <p className="text-sm text-gray-300">{city.name_en}</p>}
        <p className="mt-1 text-sm text-brand-300">{postCount} 篇路线</p>
      </div>
    </Link>
  )
}
```

---

## 二、链接资产页实现细节

### 2.1 `lib/linkAsset/types.ts`

```typescript
export type LinkAssetType = 'map' | 'checklist' | 'etiquette' | 'guide'

export type AggregatedSpot = {
  name_zh: string
  name_en?: string
  name_ja?: string
  googleMapsUrl?: string
  lat?: number
  lng?: number
  fromArticle?: string
  animeIds?: string[]
  city?: string
  photoTip?: string
}

export type LinkAsset = {
  id: string
  type: LinkAssetType
  title_zh: string
  title_en?: string
  description_zh?: string
  description_en?: string
  filterByAnimeIds?: string[]
  filterByCities?: string[]
  filterByTags?: string[]
  content_zh?: string
  content_en?: string
  relatedPosts?: string[]
  seoTitle_zh?: string
  seoTitle_en?: string
  seoDescription_zh?: string
  seoDescription_en?: string
  cover?: string
  publishDate?: string
  updatedDate?: string
}
```

### 2.2 `lib/linkAsset/getAllLinkAssets.ts`

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import type { LinkAsset } from './types'

const ASSET_DIR = path.join(process.cwd(), 'content', 'link-assets')

export async function getAllLinkAssets(): Promise<LinkAsset[]> {
  let files: string[] = []
  try {
    files = await fs.readdir(ASSET_DIR)
  } catch {
    return []
  }
  
  const jsonFiles = files.filter((f) => f.endsWith('.json'))
  const assets: LinkAsset[] = []
  
  for (const file of jsonFiles) {
    const full = path.join(ASSET_DIR, file)
    const raw = await fs.readFile(full, 'utf-8').catch(() => '{}')
    try {
      const data = JSON.parse(raw) as LinkAsset
      if (data.id && data.type && data.title_zh) {
        assets.push(data)
      }
    } catch {
      // ignore invalid JSON
    }
  }
  
  return assets
}
```

### 2.3 `app/(site)/resources/page.tsx` 骨架

```typescript
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '巡礼资源',
  description: '圣地巡礼地图、清单、礼仪指南等实用资源，一站式获取。',
  alternates: { canonical: '/resources' },
}

export const dynamic = 'force-dynamic'

const TYPE_LABELS: Record<string, string> = {
  map: '🗺️ 地图',
  checklist: '✅ 清单',
  etiquette: '🙏 礼仪',
  guide: '📖 指南',
}

export default async function ResourcesPage() {
  const assets = await getAllLinkAssets()
  
  return (
    <div>
      <h1 className="text-2xl font-bold">巡礼资源</h1>
      <p className="mt-2 text-gray-600">实用的地图、清单与指南，助你更好地完成圣地巡礼。</p>
      
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {assets.map((asset) => (
          <Link
            key={asset.id}
            href={`/resources/${asset.id}`}
            className="group relative overflow-hidden rounded-xl border bg-white p-6 hover:shadow-lg transition-shadow"
          >
            <span className="inline-block px-2 py-1 text-xs rounded-full bg-gray-100">
              {TYPE_LABELS[asset.type] || asset.type}
            </span>
            <h2 className="mt-3 text-xl font-bold group-hover:text-brand-600">{asset.title_zh}</h2>
            {asset.description_zh && (
              <p className="mt-2 text-sm text-gray-600 line-clamp-2">{asset.description_zh}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
```

### 2.4 `app/(site)/resources/[id]/page.tsx` 骨架

```typescript
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'
import { aggregateSpots } from '@/lib/linkAsset/aggregateSpots'
import MapAssetView from '@/components/resources/MapAssetView'
import EtiquetteAssetView from '@/components/resources/EtiquetteAssetView'
import ChecklistAssetView from '@/components/resources/ChecklistAssetView'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const asset = await getLinkAssetById(id)
  if (!asset) return { title: '未找到资源', robots: { index: false } }
  
  return {
    title: asset.seoTitle_zh || asset.title_zh,
    description: asset.seoDescription_zh || asset.description_zh,
    alternates: { canonical: `/resources/${id}` },
    openGraph: {
      type: 'website',
      title: asset.title_zh,
      description: asset.description_zh,
      url: `/resources/${id}`,
      images: asset.cover ? [asset.cover] : undefined,
    },
  }
}

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const asset = await getLinkAssetById(id)
  if (!asset) return notFound()
  
  // 根据类型准备数据
  let spots: AggregatedSpot[] = []
  if (asset.type === 'map' || asset.type === 'checklist') {
    spots = await aggregateSpots({
      filterByAnimeIds: asset.filterByAnimeIds,
      filterByCities: asset.filterByCities,
    })
  }
  
  return (
    <div className="space-y-8">
      <Breadcrumbs items={[
        { name: '首页', href: '/' },
        { name: '巡礼资源', href: '/resources' },
        { name: asset.title_zh, href: `/resources/${id}` },
      ]} />
      
      <header>
        <h1 className="text-3xl font-bold">{asset.title_zh}</h1>
        {asset.description_zh && <p className="mt-2 text-gray-600">{asset.description_zh}</p>}
      </header>
      
      {/* 根据类型渲染不同视图 */}
      {asset.type === 'map' && <MapAssetView asset={asset} spots={spots} />}
      {asset.type === 'checklist' && <ChecklistAssetView asset={asset} spots={spots} />}
      {asset.type === 'etiquette' && <EtiquetteAssetView asset={asset} />}
      {asset.type === 'guide' && <EtiquetteAssetView asset={asset} />}
    </div>
  )
}
```

---

## 三、文章组件实现细节

### 3.1 `components/content/TldrBox.tsx`

```typescript
import type { TldrInfo } from '@/lib/mdx/types'

type Props = {
  tldr?: TldrInfo
}

export default function TldrBox({ tldr }: Props) {
  if (!tldr) return null
  
  return (
    <div className="not-prose my-6 rounded-xl border-2 border-brand-200 bg-brand-50 p-4">
      <div className="font-bold text-brand-700 mb-2">TL;DR</div>
      <div className="flex flex-wrap gap-4 text-sm">
        {tldr.duration && (
          <span className="flex items-center gap-1">
            <span>⏱</span> {tldr.duration}
          </span>
        )}
        {tldr.totalSpots && (
          <span className="flex items-center gap-1">
            <span>📍</span> {tldr.totalSpots} 个点位
          </span>
        )}
        {tldr.transport && (
          <span className="flex items-center gap-1">
            <span>🚃</span> {tldr.transport}
          </span>
        )}
        {tldr.estimatedCost && (
          <span className="flex items-center gap-1">
            <span>💴</span> {tldr.estimatedCost}
          </span>
        )}
      </div>
      {(tldr.startPoint || tldr.endPoint) && (
        <div className="mt-2 text-sm text-gray-700">
          🚩 {tldr.startPoint || '起点'} → {tldr.endPoint || '终点'}
        </div>
      )}
    </div>
  )
}
```

### 3.2 `components/content/TransportCard.tsx`

```typescript
import type { TransportInfo } from '@/lib/mdx/types'

type Props = {
  transport?: TransportInfo
}

export default function TransportCard({ transport }: Props) {
  if (!transport) return null
  
  return (
    <div className="not-prose my-6 rounded-xl border bg-blue-50 p-4">
      <div className="font-bold text-blue-900 mb-3">🚃 交通指南</div>
      
      {transport.icCard && (
        <div className="mb-2">
          <span className="text-sm font-medium text-blue-800">推荐 IC 卡：</span>
          <span className="text-sm text-blue-700 ml-1">{transport.icCard}</span>
        </div>
      )}
      
      {transport.lines?.length ? (
        <div className="mb-2">
          <span className="text-sm font-medium text-blue-800">涉及线路：</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {transport.lines.map((line, i) => (
              <span key={i} className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                {line}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      
      {transport.tips?.length ? (
        <div>
          <span className="text-sm font-medium text-blue-800">小贴士：</span>
          <ul className="mt-1 text-sm text-blue-700 list-disc list-inside">
            {transport.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
```

### 3.3 `components/content/PhotoTipsList.tsx`

```typescript
type Props = {
  tips?: string[]
}

export default function PhotoTipsList({ tips }: Props) {
  if (!tips?.length) return null
  
  return (
    <div className="not-prose my-6 rounded-xl border bg-amber-50 p-4">
      <div className="font-bold text-amber-900 mb-3">📷 拍摄建议</div>
      <ul className="space-y-2">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
            <span className="shrink-0 mt-0.5">•</span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

---

## 四、国际化实现细节

### 4.1 `lib/i18n/locale.ts`

```typescript
export type Locale = 'zh' | 'en'

export const DEFAULT_LOCALE: Locale = 'zh'

export const LOCALES: Locale[] = ['zh', 'en']

export function getLocaleFromPath(pathname: string): Locale {
  if (pathname.startsWith('/en')) return 'en'
  return 'zh'
}

export function localizedPath(path: string, locale: Locale): string {
  // 移除可能存在的 /en 前缀
  const cleanPath = path.replace(/^\/en/, '')
  if (locale === 'en') {
    return `/en${cleanPath}`
  }
  return cleanPath
}

export function getAlternateLanguages(path: string, siteOrigin: string) {
  const cleanPath = path.replace(/^\/en/, '')
  return {
    'zh': `${siteOrigin}${cleanPath}`,
    'en': `${siteOrigin}/en${cleanPath}`,
    'x-default': `${siteOrigin}${cleanPath}`,
  }
}
```

### 4.2 `lib/i18n/translations.ts`

```typescript
import type { Locale } from './locale'

type TranslationKey = 
  | 'nav.home' | 'nav.anime' | 'nav.city' | 'nav.resources' | 'nav.about'
  | 'common.readMore' | 'common.openInMaps' | 'common.articles'
  | 'city.transportTips' | 'city.relatedRoutes'
  | 'resource.map' | 'resource.checklist' | 'resource.etiquette' | 'resource.guide'

const translations: Record<Locale, Record<TranslationKey, string>> = {
  zh: {
    'nav.home': '首页',
    'nav.anime': '作品',
    'nav.city': '城市',
    'nav.resources': '资源',
    'nav.about': '关于',
    'common.readMore': '阅读更多',
    'common.openInMaps': '在 Google 地图打开',
    'common.articles': '篇文章',
    'city.transportTips': '交通小贴士',
    'city.relatedRoutes': '相关路线',
    'resource.map': '地图',
    'resource.checklist': '清单',
    'resource.etiquette': '礼仪',
    'resource.guide': '指南',
  },
  en: {
    'nav.home': 'Home',
    'nav.anime': 'Anime',
    'nav.city': 'Cities',
    'nav.resources': 'Resources',
    'nav.about': 'About',
    'common.readMore': 'Read More',
    'common.openInMaps': 'Open in Google Maps',
    'common.articles': 'articles',
    'city.transportTips': 'Transport Tips',
    'city.relatedRoutes': 'Related Routes',
    'resource.map': 'Map',
    'resource.checklist': 'Checklist',
    'resource.etiquette': 'Etiquette',
    'resource.guide': 'Guide',
  },
}

export function t(key: TranslationKey, locale: Locale): string {
  return translations[locale]?.[key] || translations.zh[key] || key
}
```

### 4.3 `app/(site-en)/layout.tsx`

```typescript
import '../../styles/globals.css'
import SiteShell from '@/components/layout/SiteShell'

export default function EnglishSiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteShell locale="en">
          {children}
        </SiteShell>
      </body>
    </html>
  )
}
```

---

## 五、Sitemap 更新

### 5.1 更新后的 `app/sitemap.ts`

```typescript
import type { MetadataRoute } from 'next'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { getAllAnime } from '@/lib/anime/getAllAnime'
import { getAllCities } from '@/lib/city/getAllCities'
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import { getSiteOrigin } from '@/lib/seo/site'

export const runtime = 'nodejs'
export const revalidate = 0

function toLastModified(input?: string): Date | undefined {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return undefined
  const dt = new Date(raw)
  if (!Number.isFinite(dt.getTime())) return undefined
  return dt
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteOrigin()
  
  const [posts, anime, cities, assets] = await Promise.all([
    getAllPublicPosts('zh'),
    getAllAnime().catch(() => []),
    getAllCities().catch(() => []),
    getAllLinkAssets().catch(() => []),
  ])
  
  const items: MetadataRoute.Sitemap = [
    // 静态页面
    { url: `${base}/`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/about`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/anime`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/city`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/resources`, changeFrequency: 'monthly', priority: 0.6 },
    
    // 英文静态页面
    { url: `${base}/en`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/en/anime`, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${base}/en/city`, changeFrequency: 'weekly', priority: 0.4 },
    { url: `${base}/en/resources`, changeFrequency: 'monthly', priority: 0.5 },
  ]
  
  // 作品页面
  for (const a of anime) {
    const id = String(a?.id || '').trim()
    if (!id) continue
    items.push({
      url: `${base}/anime/${encodeURIComponent(id)}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  }
  
  // 城市页面
  for (const c of cities) {
    items.push({
      url: `${base}/city/${encodeURIComponent(c.id)}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  }
  
  // 资产页面
  for (const asset of assets) {
    items.push({
      url: `${base}/resources/${encodeURIComponent(asset.id)}`,
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }
  
  // 文章页面
  for (const p of posts) {
    items.push({
      url: `${base}${p.path}`,
      lastModified: toLastModified(p.updatedAt || p.publishedAt || p.publishDate),
      changeFrequency: 'monthly',
      priority: 0.7,
    })
  }
  
  return items
}
```

---

## 六、文件创建检查清单

实施时依次创建以下文件：

### Week 1, Day 1-2: 城市 Hub
- [ ] `content/city/tokyo.json`
- [ ] `lib/city/types.ts`
- [ ] `lib/city/getAllCities.ts`
- [ ] `lib/city/getCityById.ts`
- [ ] `components/city/CityCard.tsx`
- [ ] `app/(site)/city/page.tsx`
- [ ] `app/(site)/city/[id]/page.tsx`

### Week 1, Day 2-3: 链接资产页
- [ ] `content/link-assets/pilgrimage-map.json`
- [ ] `content/link-assets/pilgrimage-etiquette.json`
- [ ] `lib/linkAsset/types.ts`
- [ ] `lib/linkAsset/getAllLinkAssets.ts`
- [ ] `lib/linkAsset/getLinkAssetById.ts`
- [ ] `lib/linkAsset/aggregateSpots.ts`
- [ ] `components/resources/MapAssetView.tsx`
- [ ] `components/resources/EtiquetteAssetView.tsx`
- [ ] `components/resources/ChecklistAssetView.tsx`
- [ ] `app/(site)/resources/page.tsx`
- [ ] `app/(site)/resources/[id]/page.tsx`

### Week 1, Day 3-4: 国际化基础
- [ ] `lib/i18n/locale.ts`
- [ ] `lib/i18n/translations.ts`
- [ ] `app/(site-en)/layout.tsx`
- [ ] 更新各页面 `generateMetadata` 添加 hreflang

### Week 1, Day 4-5: 文章模板
- [ ] 更新 `lib/mdx/types.ts` (添加 TldrInfo, TransportInfo)
- [ ] `components/content/TldrBox.tsx`
- [ ] `components/content/TransportCard.tsx`
- [ ] `components/content/PhotoTipsList.tsx`
- [ ] 更新 `lib/mdx/mdxComponents.tsx`
- [ ] 更新 `content/zh/posts/README.md`

### Week 2: 完善 + 测试
- [ ] 更新 `app/sitemap.ts`
- [ ] 英文站页面复制调整
- [ ] SEO 审计验证
- [ ] 更新 AGENTS.md
