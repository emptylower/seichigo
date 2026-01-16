import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import FeaturedPost from '@/components/bookstore/FeaturedPost'
import FeaturedEmpty from '@/components/bookstore/FeaturedEmpty'
import BookShelf from '@/components/bookstore/BookShelf'
import Image from 'next/image'
import Link from 'next/link'
import BookCover from '@/components/bookstore/BookCover'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — 动漫圣地巡礼攻略' },
  description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — 动漫圣地巡礼攻略',
    description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划，并直接提供可导航的路线点位清单。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

const STATIC_HERO_COVERS = [
  'https://images.unsplash.com/photo-1542931287-023b922fa89b?q=80&w=600&auto=format&fit=crop', // Tokyo Tower / City (Placeholder for Your Name)
  'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=600&auto=format&fit=crop', // Tokyo Street
  'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=600&auto=format&fit=crop', // Kyoto / Shrine
]

export default async function HomePage() {
  const posts = await getAllPublicPosts('zh')
  const featured = posts[0] || null
  const latestShelf = posts.slice(1, 13)
  const more = posts.slice(13, 25)
  
  // Use first post cover as the main one if available, otherwise fallback
  const mainCover = posts[0]?.cover || STATIC_HERO_COVERS[0]
  
  // Construct the display array: [Main Cover, Static 2, Static 3]
  const heroDisplay = [mainCover, STATIC_HERO_COVERS[1], STATIC_HERO_COVERS[2]]

  return (
    <div className="space-y-16 pb-12">
      {/* Hero Section - Magazine Style */}
      <section className="relative px-6 py-12 md:py-20 lg:px-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-50/50 to-purple-50/30 -z-10" />
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center max-w-7xl mx-auto">
          <div className="space-y-8 text-center lg:text-left">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl leading-tight">
              出发，<br />
              去见证那个风景。
            </h1>
            <p className="max-w-lg mx-auto lg:mx-0 text-lg text-gray-600 sm:text-xl leading-relaxed">
              用好读的长文、精致排版和实用的地点列表，<br className="hidden sm:block" />
              帮你规划从屏幕到现实的每一次巡礼。
            </p>
            <div className="flex flex-wrap justify-center lg:justify-start gap-4 pt-2">
              <Link
                href="/anime"
                className="rounded-full bg-brand-600 px-8 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-200 transition-all hover:bg-brand-700 hover:shadow-xl hover:-translate-y-0.5"
              >
                浏览作品索引
              </Link>
              <Link
                href="/submit"
                className="rounded-full border border-gray-200 bg-white px-8 py-4 text-sm font-semibold text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:text-gray-900"
              >
                投稿你的巡礼
              </Link>
            </div>
          </div>

          <div className="relative hidden lg:block h-[400px]">
            {/* Dynamic Cover Gallery - Fan Stack Effect */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md h-80">
              {heroDisplay.map((src, i) => (
                <div 
                  key={i}
                  className={`absolute top-0 w-64 aspect-[3/4] rounded-xl shadow-2xl transition-transform hover:scale-105 duration-500 ease-out`}
                  style={{
                    left: `${50 + (i - 1) * 25}%`,
                    top: `${(i - 1) * 20}px`,
                    transform: `translateX(-50%) rotate(${(i - 1) * 12}deg)`,
                    zIndex: 3 - i,
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
                    <img 
                      src={src} 
                      alt="" 
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-30" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Featured Post */}
      {featured ? (
        <section className="space-y-6 max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 px-1 border-l-4 border-brand-500 pl-3">
             <h2 className="text-2xl font-bold tracking-tight text-gray-900">本周精选</h2>
          </div>
          <FeaturedPost item={featured} />
        </section>
      ) : null}

      {/* Latest Shelf */}
      <section className="space-y-6 max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">最新上架</h2>
          <Link href="/anime" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            查看全部作品 →
          </Link>
        </div>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <BookShelf items={latestShelf} />
        </div>
      </section>

      {/* More Posts Grid */}
      {more.length ? (
        <section className="space-y-6 max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between px-1 border-l-4 border-brand-500 pl-3">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">继续探索</h2>
            <Link href="/anime" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              去作品索引 →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {more.map((p) => (
              <Link
                key={p.path}
                href={p.path}
                className="group flex flex-col gap-3 no-underline hover:no-underline"
              >
                <BookCover
                  path={p.path}
                  title={p.title}
                  animeIds={p.animeIds}
                  city={p.city}
                  routeLength={p.routeLength}
                  publishDate={p.publishDate}
                  cover={p.cover}
                />
                <div className="space-y-1 px-1">
                  <div className="line-clamp-2 text-lg font-bold leading-snug text-gray-900 group-hover:text-brand-600">
                    {p.title}
                  </div>
                  <div className="text-sm text-gray-500">
                    {[p.animeIds?.length ? p.animeIds.join('、') : 'unknown', p.city].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* App Promo - Minimalist & Light */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="rounded-3xl border border-gray-100 bg-gradient-to-r from-gray-50 to-white px-6 py-10 sm:px-12">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex-1 space-y-3 text-center md:text-left">
              <div className="flex items-center justify-center gap-3 md:justify-start">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-gray-100">
                  <Image
                    src="/brand/app-logo.png"
                    alt="Logo"
                    width={32}
                    height={32}
                    className="rounded-lg"
                  />
                </span>
                <h2 className="text-xl font-bold text-gray-900">SeichiGo App</h2>
                <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-600">
                  Coming Soon
                </span>
              </div>
              <p className="max-w-md text-sm leading-relaxed text-gray-500">
                我们正在开发移动端应用，未来将支持离线地图与一键导航。
                <br className="hidden sm:block" />
                把所有圣地装进口袋，随时出发。
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <button disabled className="group flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-400 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-.69-.32-1.54-.32-2.19 0-1.04.56-2.15.56-3.14-.43-1.8-1.79-2.92-5.15-1.21-8.1 1.1-1.9 3.09-2.8 4.75-2.73 1.16.05 2.03.62 2.67.62.63 0 1.76-.66 3.07-.56 1.05.08 2.02.51 2.76 1.44-2.52 1.5-2.07 5.23.47 6.27-.54 1.35-1.22 2.67-2.3 4.18-.76 1.05-1.55 2.08-2.69 1.95-.76-.08-1.55-.53-2.69-.53-1.14 0-1.92.45-2.69.53-1.14.13-1.93-.9-2.69-1.95-.56-.78-1.08-1.63-1.55-2.52 1.5-2.52 3.8-2.8 5.6-1.05.65.63 1.33 1.18 2.05 1.63.72.45 1.48.83 2.28 1.13.8.3 1.63.53 2.48.68.85.15 1.73.23 2.63.23h.1z"/>
                  <path d="M12.03 7.24c-.13-2.3 1.73-4.3 3.97-4.5.25 2.5-2.45 4.75-3.97 4.5z"/>
                </svg>
                <span>App Store</span>
              </button>
              <button disabled className="group flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium text-gray-400 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.609 1.814L13.792 12 3.61 22.186a2.048 2.048 0 01-2.02-3.12l1.64-7.066-1.64-7.066a2.048 2.048 0 012.02-3.12zM15.5 12c0 .133-.006.265-.018.396l-7.066 7.066c-.63.63-1.72.184-1.72-.707V5.245c0-.89 1.09-1.337 1.72-.707l7.066 7.066c.012.131.018.263.018.396z"/>
                </svg>
                <span>Google Play</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
