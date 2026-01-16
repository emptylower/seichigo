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

export default async function HomePage() {
  const posts = await getAllPublicPosts('zh')
  const featured = posts[0] || null
  const latestShelf = posts.slice(1, 13)
  const more = posts.slice(13, 25)

  return (
    <div className="space-y-16 pb-12">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600 to-purple-700 opacity-90" />
        <div className="absolute inset-0 bg-[url('/brand/grid-pattern.svg')] opacity-10" />
        <div className="relative px-6 py-16 sm:px-12 sm:py-24">
          <div className="max-w-2xl space-y-6">
            <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
              出发，<br />
              去见证那个风景。
            </h1>
            <p className="max-w-lg text-lg text-brand-100 sm:text-xl">
              用好读的长文、精致排版和实用的地点列表，帮你规划从屏幕到现实的每一次巡礼。
            </p>
            <div className="flex flex-wrap gap-4 pt-4">
              <Link
                href="/anime"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50"
              >
                浏览作品索引
              </Link>
              <Link
                href="/submit"
                className="rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                投稿你的巡礼
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Post */}
      {featured ? (
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
             <h2 className="text-2xl font-bold tracking-tight text-gray-900">本周精选</h2>
          </div>
          <FeaturedPost item={featured} />
        </section>
      ) : null}

      {/* Latest Shelf */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-1">
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
        <section className="space-y-6">
          <div className="flex items-center justify-between px-1">
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

      {/* App Promo - Refreshed */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 to-slate-800 text-white shadow-2xl">
        <div className="absolute top-0 right-0 -mt-20 -mr-20 h-80 w-80 rounded-full bg-brand-500 opacity-20 blur-3xl" />
        <div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-80 w-80 rounded-full bg-purple-500 opacity-20 blur-3xl" />
        
        <div className="relative grid items-center gap-12 px-8 py-16 md:grid-cols-2 md:px-16">
          <div className="space-y-6 text-center md:text-left">
            <div>
              <div className="inline-flex items-center rounded-full bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-200 ring-1 ring-inset ring-brand-500/20">
                Coming Soon
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
                把圣地装进口袋
              </h2>
              <p className="mt-4 text-lg text-gray-300">
                SeichiGo App 正在全力开发中。<br className="hidden md:block" />
                未来你将可以直接在 App 中打开这些精选路线，<br className="hidden md:block" />
                一键导航到每一个巡礼点位，记录你的每一次相遇。
              </p>
            </div>
            
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center md:justify-start">
              <button disabled className="group flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-gray-900 transition-all hover:bg-gray-100 disabled:opacity-80 disabled:cursor-not-allowed">
                <svg className="h-5 w-5 text-gray-900" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-.69-.32-1.54-.32-2.19 0-1.04.56-2.15.56-3.14-.43-1.8-1.79-2.92-5.15-1.21-8.1 1.1-1.9 3.09-2.8 4.75-2.73 1.16.05 2.03.62 2.67.62.63 0 1.76-.66 3.07-.56 1.05.08 2.02.51 2.76 1.44-2.52 1.5-2.07 5.23.47 6.27-.54 1.35-1.22 2.67-2.3 4.18-.76 1.05-1.55 2.08-2.69 1.95-.76-.08-1.55-.53-2.69-.53-1.14 0-1.92.45-2.69.53-1.14.13-1.93-.9-2.69-1.95-.56-.78-1.08-1.63-1.55-2.52 1.5-2.52 3.8-2.8 5.6-1.05.65.63 1.33 1.18 2.05 1.63.72.45 1.48.83 2.28 1.13.8.3 1.63.53 2.48.68.85.15 1.73.23 2.63.23h.1z"/>
                  <path d="M12.03 7.24c-.13-2.3 1.73-4.3 3.97-4.5.25 2.5-2.45 4.75-3.97 4.5z"/>
                </svg>
                <span>App Store</span>
              </button>
              <button disabled className="group flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.609 1.814L13.792 12 3.61 22.186a2.048 2.048 0 01-2.02-3.12l1.64-7.066-1.64-7.066a2.048 2.048 0 012.02-3.12zM15.5 12c0 .133-.006.265-.018.396l-7.066 7.066c-.63.63-1.72.184-1.72-.707V5.245c0-.89 1.09-1.337 1.72-.707l7.066 7.066c.012.131.018.263.018.396z"/>
                </svg>
                <span>Google Play</span>
              </button>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[280px]">
            {/* Phone Frame */}
            <div className="relative aspect-[9/19] w-full overflow-hidden rounded-[3rem] border-[8px] border-gray-800 bg-gray-900 shadow-2xl ring-1 ring-white/10">
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900">
                {/* App Icon in Phone */}
                <div className="relative h-24 w-24 overflow-hidden rounded-2xl shadow-xl ring-1 ring-white/10">
                  <Image
                    src="/brand/app-logo.png"
                    alt="App Icon"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="mt-6 text-center">
                  <div className="text-xl font-bold text-white tracking-wide">SeichiGo</div>
                  <div className="text-xs text-gray-400">动漫圣地巡礼</div>
                </div>
              </div>
              
              {/* Dynamic Island / Notch */}
              <div className="absolute top-0 left-1/2 h-6 w-24 -translate-x-1/2 rounded-b-xl bg-black"></div>
              
              {/* Screen Reflection */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent rounded-[2.5rem]"></div>
            </div>
            
            {/* Floating Elements Decoration */}
            <div className="absolute -top-6 -right-6 h-16 w-16 animate-bounce rounded-2xl bg-white/10 p-3 backdrop-blur-md delay-700 shadow-lg ring-1 ring-white/20">
               <svg className="h-full w-full text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
               </svg>
            </div>
            <div className="absolute top-1/2 -left-8 h-12 w-12 animate-pulse rounded-full bg-purple-500/20 p-2 backdrop-blur-md delay-1000 shadow-lg ring-1 ring-white/20">
               <svg className="h-full w-full text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
               </svg>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
