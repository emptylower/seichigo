import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import FeaturedPost from '@/components/bookstore/FeaturedPost'
import FeaturedEmpty from '@/components/bookstore/FeaturedEmpty'
import BookShelf from '@/components/bookstore/BookShelf'
import Image from 'next/image'
import Link from 'next/link'
import BookCover from '@/components/bookstore/BookCover'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const posts = await getAllPublicPosts('zh')
  const featured = posts[0] || null
  const latestShelf = posts.slice(1, 13)
  const more = posts.slice(13, 21)

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">书城</h1>
            <p className="text-sm text-gray-600">
              用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/anime" className="btn-primary no-underline hover:no-underline">
              浏览作品
            </Link>
            <Link href="/submit" className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 no-underline hover:bg-gray-50 hover:no-underline">
              去投稿
            </Link>
          </div>
        </div>

        {featured ? (
          <FeaturedPost item={featured} />
        ) : (
          <FeaturedEmpty />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">最新上架</h2>
          <Link href="/anime" className="text-sm text-gray-600 no-underline hover:text-brand-700 hover:underline">
            查看全部作品 →
          </Link>
        </div>
        <BookShelf items={latestShelf} />
      </section>

      {more.length ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">继续逛逛</h2>
            <Link href="/anime" className="text-sm text-gray-600 no-underline hover:text-brand-700 hover:underline">
              去作品索引 →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {more.map((p) => (
              <Link
                key={p.path}
                href={p.path}
                className="group flex gap-4 rounded-2xl border border-pink-100 bg-white p-4 shadow-sm no-underline hover:no-underline"
              >
                <div className="w-20 shrink-0">
                  <BookCover
                    path={p.path}
                    title={p.title}
                    animeIds={p.animeIds}
                    city={p.city}
                    routeLength={p.routeLength}
                    publishDate={p.publishDate}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-xs text-gray-500">{[p.animeIds?.length ? p.animeIds.join('、') : 'unknown', p.city].filter(Boolean).join(' · ') || '—'}</div>
                  <div className="line-clamp-2 text-base font-semibold leading-snug text-gray-900 group-hover:text-brand-700">
                    {p.title}
                  </div>
                  {p.publishDate ? <div className="text-xs text-gray-400">发布：{p.publishDate}</div> : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-xl font-bold">SeichiGo App 预告</h2>
        <p className="text-gray-600">未来将提供“在 App 中打开本路线”等能力。欢迎订阅/关注我们的更新。</p>
        <div className="card grid gap-6 md:grid-cols-[1fr,360px] md:items-center">
          <div className="space-y-2">
            <div className="text-sm text-gray-700">把这些路线装进口袋：收藏、离线、打开导航、轻量打卡。</div>
            <div className="text-sm text-gray-600">Mock: 订阅入口（稍后替换成真实外部链接）</div>
          </div>
          <Image
            src="/brand/app-logo.png"
            alt="SeichiGo App"
            width={640}
            height={640}
            className="mx-auto h-auto w-full max-w-sm rounded-lg bg-white object-cover"
            sizes="(min-width: 1024px) 360px, 100vw"
          />
        </div>
      </section>
    </div>
  )
}
