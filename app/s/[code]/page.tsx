import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { resolveMapShareSnapshot } from '@/lib/anitabi/share'
import { runShareBackground } from '@/lib/share/background'
import { getShareApiDeps } from '@/lib/share/api'
import { isShareCode } from '@/lib/share/shortCode'
import { shareCardFingerprint } from '@/lib/share/store'
import {
  buildShareDescription,
  buildShareOgImage,
  buildShareOgImageAlt,
  buildShareOgImageUrl,
  buildShareRedirectFallbackText,
  buildShareRedirectTarget,
  buildShareTitle,
} from '@/lib/share/view'
import type { ShareLinkRecord } from '@/lib/share/repo'
import type { SupportedLocale } from '@/lib/i18n/types'

// og:locale 用语言_地区格式；收在 page 内的小映射，不加 i18n key
const OG_LOCALE: Record<SupportedLocale, string> = {
  zh: 'zh_CN',
  ja: 'ja_JP',
  en: 'en_US',
}

// 短链每次都要读库拿 imageKey 与 clicks，不能被静态化
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type PageParams = { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * React cache()：generateMetadata 与页面体同处一次请求渲染，findByCode 只查一次库。
 * （vitest 无 React 缓存作用域时退化为直调，行为不变）
 */
const loadLink = cache(async (code: string): Promise<ShareLinkRecord | null> => {
  if (!isShareCode(code)) return null
  try {
    const deps = await getShareApiDeps()
    return await deps.repo.findByCode(code)
  } catch (error) {
    console.error('[share.link.load_failed]', { code, error })
    return null
  }
})

function readChannel(searchParams: Record<string, string | string[] | undefined>): string | null {
  const raw = searchParams.c
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

export async function generateMetadata({ params, searchParams }: PageParams): Promise<Metadata> {
  await searchParams
  const { code } = await params
  const link = await loadLink(code)
  if (!link) {
    return { title: { absolute: '链接不存在 | SeichiGo' }, robots: { index: false, follow: false } }
  }

  const { origin } = await getShareApiDeps()
  const snapshot = await resolveMapShareSnapshot(link.locale, {
    b: link.bangumiId,
    p: link.pointId,
  })

  // 有 imageKey（登录用户传过带实拍的卡）→ 维持现状并靠 ?v=<指纹> 破爬虫缓存；
  // 否则指向服务端卡片路由——匿名分享从此也有完整卡片预览，不需要任何用户上传
  const image = buildShareOgImageUrl({
    origin,
    code: link.code,
    pointId: link.pointId,
    locale: link.locale,
    imageKey: link.imageKey,
    fingerprint: link.imageKey ? shareCardFingerprint(link.imageKey) : null,
  })

  // og:image 对象带 width/height/type/alt：缺尺寸时部分平台不出预览。
  // 上传卡按链接自身的版式；匿名指向卡片路由固定横版
  const ogImage = buildShareOgImage({
    url: image,
    layout: link.imageKey ? link.layout : 'landscape',
    alt: buildShareOgImageAlt({
      locale: link.locale,
      pointName: snapshot?.pointName || '',
      bangumiTitle: snapshot?.bangumiTitle || '',
    }),
  })

  const title = buildShareTitle({
    locale: link.locale,
    pointName: snapshot?.pointName || '',
    bangumiTitle: snapshot?.bangumiTitle || 'SeichiGo',
  })
  const description = buildShareDescription({
    locale: link.locale,
    bangumiTitle: snapshot?.bangumiTitle || 'SeichiGo',
    city: snapshot?.bangumiCity ?? null,
    ep: snapshot?.pointEp ?? null,
  })

  return {
    title: { absolute: title },
    description,
    // 短链只是分享入口，索引价值全在 /map 与作品页上
    robots: { index: false, follow: true },
    openGraph: {
      type: 'website',
      siteName: 'SeichiGo',
      locale: OG_LOCALE[link.locale],
      title,
      description,
      url: `${origin}/s/${link.code}`,
      images: [ogImage],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  }
}

export default async function ShareRedirectPage({ params, searchParams }: PageParams) {
  const { code } = await params
  const resolvedSearchParams = await searchParams
  const link = await loadLink(code)
  if (!link) notFound()

  const deps = await getShareApiDeps()
  // 点击计数不阻塞响应；waitUntil 必须以 ctx 为 this 调用（见 lib/share/background.ts）
  runShareBackground(deps.repo.incrementClicks(link.code))

  const target = buildShareRedirectTarget({
    locale: link.locale,
    bangumiId: link.bangumiId,
    pointId: link.pointId,
    channel: readChannel(resolvedSearchParams),
  })
  const absolute = `${deps.origin}${target}`

  return (
    <>
      {/* 爬虫不执行 JS，会留在本页读卡片；meta refresh 会让抓取器跳去地图页
          改用地图页的 og:image，禁用。真实用户由脚本瞬时跳转 */}
      <script
        dangerouslySetInnerHTML={{
          // `</script>` 若混进 URL 会提前闭合标签，先转义 < 再进 JSON 字符串
          __html: `window.location.replace(${JSON.stringify(absolute).replace(/</g, '\\u003c')});`,
        }}
      />
      <main style={{ padding: '48px 24px', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        {/* 禁用 JS 的兜底链接；文案按 locale 三语收在 lib/share/view.ts */}
        <a href={absolute} style={{ color: '#db2777', fontSize: 14 }}>
          {buildShareRedirectFallbackText({ locale: link.locale })}
        </a>
      </main>
    </>
  )
}
