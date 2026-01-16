import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: '关于 SeichiGo',
  description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，连接二次元与现实的桥梁。',
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    url: '/about',
    title: '关于 SeichiGo',
    description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，连接二次元与现实的桥梁。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '关于 SeichiGo',
    description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，连接二次元与现实的桥梁。',
    images: ['/twitter-image'],
  },
}

export default function AboutPage() {
  return (
    <div className="space-y-24 pb-20">
      {/* Hero Section */}
      <section className="relative pt-12 pb-16 text-center md:pt-24 md:pb-20">
        <div className="mx-auto max-w-3xl px-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
            连接<span className="text-brand-600">次元</span>与<span className="text-brand-600">现实</span>的桥梁。
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 leading-relaxed md:text-xl">
            每一部动画，都是一场梦。
            <br className="hidden sm:block" />
            而圣地巡礼，就是去现实中触碰那个梦的边缘。
          </p>
        </div>
        
        {/* Decorative Background Elements */}
        <div className="pointer-events-none absolute top-0 left-1/2 -z-10 -translate-x-1/2 opacity-30">
          <div className="h-96 w-96 rounded-full bg-brand-200 blur-3xl" />
        </div>
      </section>

      {/* Mission Section */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-12 md:grid-cols-3">
          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">深度考据</h3>
            <p className="text-gray-600 leading-relaxed">
              拒绝模糊的“大概位置”。我们追求精确到经纬度的点位还原，对比动画分镜与现实场景，不错过任何一个细节。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 text-purple-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">杂志质感</h3>
            <p className="text-gray-600 leading-relaxed">
              攻略不应只是枯燥的说明书。我们坚持精致的图文排版，让阅读攻略的过程，本身就成为一场美好的精神巡礼。
            </p>
          </div>

          <div className="space-y-4 rounded-2xl bg-gray-50 p-8 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">可行性第一</h3>
            <p className="text-gray-600 leading-relaxed">
              从交通方案到最佳拍摄机位，我们提供保姆级的实操指引，解决“怎么去”的难题，让你的出发不再犹豫。
            </p>
          </div>
        </div>
      </section>

      {/* Story Text */}
      <section className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-2xl font-bold text-gray-900">为什么建立 SeichiGo？</h2>
        <div className="mt-6 space-y-6 text-lg text-gray-600 leading-relaxed">
          <p>
            很多时候，当我们看完一部感人的动画，心中涌起“想去这里看看”的冲动时，
            却往往止步于繁琐的信息检索。零散的坐标、模糊的截图、过时的交通信息……
            这些障碍让热血逐渐冷却。
          </p>
          <p>
            我们希望改变这一点。SeichiGo 致力于整理最清晰、最优美、最实用的巡礼指南。
            我们希望当你站在那个路口时，不需要低头在这个 App 和那个网页之间手忙脚乱，
            而是能抬起头，从容地对那个风景说一句：
          </p>
          <p className="font-serif text-2xl italic text-brand-600">
            “终于见到你了。”
          </p>
        </div>
      </section>

      {/* Future & Contact */}
      <section className="mx-auto max-w-4xl px-6">
        <div className="overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          <div className="grid md:grid-cols-2">
            <div className="bg-brand-600 p-10 md:p-12 text-white">
              <h3 className="text-2xl font-bold text-white">未来愿景</h3>
              <p className="mt-4 text-white/90 leading-relaxed">
                我们正在开发移动端 App，计划支持离线地图、一键导航与巡礼打卡功能。
                <br /><br />
                我们的目标是把所有圣地装进口袋，成为你打破次元壁最可靠的伙伴。
              </p>
              <div className="mt-8 inline-block rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm border border-white/20">
                Coming Soon
              </div>
            </div>
            <div className="bg-gray-800 p-10 md:p-12 text-white">
              <h3 className="text-2xl font-bold text-white">联系我们</h3>
              <p className="mt-4 text-gray-300 leading-relaxed">
                无论是发现数据错误、投稿你的巡礼故事，还是有商务合作意向，我们都非常期待听到你的声音。
              </p>
              <div className="mt-8">
                <a 
                  href="mailto:ljj231428@gmail.com" 
                  className="group inline-flex items-center gap-2 text-lg font-semibold text-white transition-colors hover:text-brand-300"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  ljj231428@gmail.com
                  <span className="block h-px max-w-0 bg-brand-300 transition-all group-hover:max-w-full"></span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
