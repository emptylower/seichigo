import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { resolveMapShareSnapshot } from '@/lib/anitabi/share'
import { resolveMirrorPublicUrl } from '@/lib/anitabi/imageProxy'
import { runShareBackground } from '@/lib/share/background'
import { getShareApiDeps } from '@/lib/share/api'
import { isShareCode } from '@/lib/share/shortCode'
import { shareCardFingerprint } from '@/lib/share/store'
import { buildShareDescription, buildShareRedirectTarget, buildShareTitle } from '@/lib/share/view'
import type { ShareLinkRecord } from '@/lib/share/repo'

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
    return { title: '链接不存在 | SeichiGo', robots: { index: false, follow: false } }
  }

  const { origin } = await getShareApiDeps()
  const snapshot = await resolveMapShareSnapshot(link.locale, {
    b: link.bangumiId,
    p: link.pointId,
  })

  // 卡片路由本身 immutable，靠 ?v=<指纹> 让换图后的 OG URL 变化，绕开爬虫侧旧缓存
  const fingerprint = link.imageKey ? shareCardFingerprint(link.imageKey) : null
  const image = link.imageKey
    ? `${origin}/api/share/img/${link.code}${fingerprint ? `?v=${fingerprint}` : ''}`
    : (snapshot?.pointImage
        ? await resolveMirrorPublicUrl(snapshot.pointImage, { kind: 'point' })
        : null) || `${origin}/opengraph-image`

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
    title,
    description,
    // 短链只是分享入口，索引价值全在 /map 与作品页上
    robots: { index: false, follow: true },
    openGraph: { type: 'website', title, description, url: `${origin}/s/${link.code}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
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
      {/* 爬虫读完 OG 再跳；不能用 next/navigation 的 redirect */}
      <meta httpEquiv="refresh" content={`0;url=${absolute}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(absolute)});`,
        }}
      />
      <main style={{ padding: '48px 24px', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <p style={{ color: '#4b5563', fontSize: 14 }}>正在跳转到 SeichiGo 地图…</p>
        <a href={absolute} style={{ color: '#db2777', fontSize: 14 }}>
          {absolute}
        </a>
      </main>
    </>
  )
}
