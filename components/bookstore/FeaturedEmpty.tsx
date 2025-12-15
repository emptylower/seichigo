import Image from 'next/image'
import Link from 'next/link'

export default function FeaturedEmpty() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50/70 via-white to-white shadow-sm">
      <div className="grid gap-6 p-6 md:grid-cols-[1fr,320px] md:items-center">
        <div className="space-y-4">
          <div className="text-xs font-semibold tracking-widest text-brand-700">SEICHIGO · BOOKSTORE</div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold leading-snug">像逛书城一样挑一条巡礼路线</h2>
            <p className="text-sm text-gray-600">目前还没有发布文章内容。你可以先去投稿/创作第一篇路线攻略。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/submit" className="btn-primary no-underline hover:no-underline">
              开始创作
            </Link>
            <Link
              href="/anime"
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 no-underline hover:bg-gray-50 hover:no-underline"
            >
              逛逛作品
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-black/5 bg-white shadow-sm">
          <div className="relative aspect-[16/10] w-full">
            <Image
              src="/brand/web-logo.png"
              alt="SeichiGo"
              fill
              className="object-cover"
              sizes="(min-width: 768px) 320px, 100vw"
              priority
            />
          </div>
        </div>
      </div>
    </section>
  )
}

