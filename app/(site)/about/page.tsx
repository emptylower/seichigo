import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '关于 SeichiGo',
  description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，强调精致排版和可执行的地点清单。',
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    url: '/about',
    title: '关于 SeichiGo',
    description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，强调精致排版和可执行的地点清单。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '关于 SeichiGo',
    description: 'SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，强调精致排版和可执行的地点清单。',
    images: ['/twitter-image'],
  },
}

export default function AboutPage() {
  return (
    <div className="prose max-w-none">
      <h1>关于 SeichiGo</h1>
      <p>SeichiGo 专注提供“单作品 × 单条线路”的圣地巡礼深度图文攻略，强调日系杂志风的精致排版和可执行的地点清单。</p>
      <h2>App 愿景</h2>
      <p>未来的 App 将支持路线打开、离线、收藏与轻度社交等体验。</p>
      <h2>联系我们</h2>
      <p>如有任何建议或合作意向，欢迎联系：<a href="mailto:ljj231428@gmail.com" className="hover:underline text-brand-600">ljj231428@gmail.com</a></p>
    </div>
  )
}
