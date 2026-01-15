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

      {/* App Promo */}
      <section className="relative overflow-hidden rounded-2xl bg-gray-50 px-6 py-12 sm:px-12">
        <div className="grid gap-8 md:grid-cols-2 md:items-center">
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">把圣地装进口袋</h2>
            <p className="text-lg text-gray-600">
              SeichiGo App 正在开发中。未来你将可以直接在 App 中打开这些路线，一键导航到每一个巡礼点位。
            </p>
            <div className="pt-2">
              <span className="inline-flex items-center rounded-md bg-gray-200 px-3 py-1 text-sm font-medium text-gray-700">
                Coming Soon
              </span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xs md:max-w-sm">
             <Image
              src="/brand/app-logo.png"
              alt="SeichiGo App"
              width={640}
              height={640}
              className="mx-auto h-auto w-48 rounded-2xl shadow-2xl md:w-64"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
