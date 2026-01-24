import '../styles/globals.css'
import type { Metadata } from 'next'
import Script from 'next/script'
import HtmlLangSync from '@/components/i18n/HtmlLangSync'
import { getSiteUrl } from '@/lib/seo/site'

export const metadata: Metadata = {
  title: {
    template: '%s | SeichiGo',
    default: 'SeichiGo — 动漫圣地巡礼攻略',
  },
  description: '用好读的长文、精致排版和实用的地点列表，帮动漫爱好者完成第一次圣地巡礼的想象与规划。',
  metadataBase: new URL(getSiteUrl()),
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
    icon: '/brand/app-logo.png',
    apple: '/brand/app-logo.png',
  },
  openGraph: {
    siteName: 'SeichiGo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <HtmlLangSync />
        <Script async src="https://www.googletagmanager.com/gtag/js?id=G-F7E894BEWR" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());

gtag('config', 'G-F7E894BEWR');`}
        </Script>
        {children}
      </body>
    </html>
  )
}
