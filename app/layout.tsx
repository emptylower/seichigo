import '../styles/globals.css'
import type { Metadata } from 'next'
import Script from 'next/script'
import HtmlLangSync from '@/components/i18n/HtmlLangSync'
import TranslateGuard from '@/components/layout/TranslateGuard'
import { getSiteUrl } from '@/lib/seo/site'
import { buildOrganizationJsonLd } from '@/lib/seo/globalJsonLd'
import Providers from '@/components/providers/Providers'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'
import { Inter } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: {
    template: '%s | SeichiGo',
    default: 'SeichiGo — 动漫圣地巡礼攻略',
  },
  description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。',
  metadataBase: new URL(getSiteUrl()),
  // iOS 的数据探测器会把时间/电话/地址文本自动包成 <a>，改动 React 之外的 DOM，
  // 水合修复时 insertBefore 找不到参照节点，抛 NotFoundError。全站关掉。
  formatDetection: { telephone: false, date: false, address: false, email: false, url: false },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: [
      { url: '/brand/icons/favicon.ico?v=2', sizes: '32x32' },
      { url: '/brand/icons/icon-192.png?v=2', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/brand/icons/favicon.ico?v=2',
    apple: '/brand/icons/apple-touch-icon.png?v=2',
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    siteName: 'SeichiGo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  other: {
    'google-adsense-account': 'ca-pub-5922869290769433',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={inter.variable}>
      <body>
        {/* 放在 body 最前面：补丁要早于任何会更新 DOM 的组件跑起来 */}
        <TranslateGuard />
        <HtmlLangSync />
        <PlaceJsonLd data={buildOrganizationJsonLd()} keyPrefix="global-org" />
        {/* GA 保持 lazyOnload 不抢首屏；延后几秒不影响统计口径，page_view 仍会发。
             AdSense 改用原生 <script async>：React 19 会把它提升到 SSR 输出的 <head>，
             渲染成真正的 script 标签，不执行 JS 的抓取路径也能看到。next/script 的
             beforeInteractive 只给一条 preload 加 body 里的客户端注入 payload，爬虫
             看不到 script 标签，达不到审核要求；代价是首页移动端 LCP 会回退。 */}
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5922869290769433"
          crossOrigin="anonymous"
        />
        <Script async src="https://www.googletagmanager.com/gtag/js?id=G-F7E894BEWR" strategy="lazyOnload" />
        <Script id="google-analytics" strategy="lazyOnload">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());

gtag('config', 'G-F7E894BEWR');`}
        </Script>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
