import { ImageResponse } from 'next/og'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getSiteOrigin } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function toAbsoluteUrl(input: string | null | undefined, base: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    return new URL(raw, base).toString()
  } catch {
    return null
  }
}

function extractCoverFromMdxFrontmatter(frontmatter: unknown): string | null {
  const fm = frontmatter && typeof frontmatter === 'object' ? (frontmatter as Record<string, unknown>) : null
  if (!fm) return null

  const candidates = [fm.cover, fm.coverImage, fm.image]
  for (const c of candidates) {
    const raw = typeof c === 'string' ? c.trim() : ''
    if (raw) return raw
  }
  return null
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  const title =
    found?.source === 'mdx'
      ? found.post.frontmatter.seoTitle || found.post.frontmatter.title
      : found?.source === 'db'
        ? found.article.seoTitle || found.article.title
        : 'SeichiGo'
  const subtitle =
    found?.source === 'mdx'
      ? [found.post.frontmatter.animeId, found.post.frontmatter.city].filter(Boolean).join(' · ')
      : found?.source === 'db'
        ? [found.article.animeIds?.[0], found.article.city].filter(Boolean).join(' · ')
        : ''

  const rawCover =
    found?.source === 'db'
      ? found.article.cover
      : found?.source === 'mdx'
        ? extractCoverFromMdxFrontmatter(found.post.frontmatter)
        : null
  const coverUrl = rawCover ? toAbsoluteUrl(rawCover, getSiteOrigin()) : null

  return new ImageResponse(
    (
      coverUrl ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            display: 'flex',
            backgroundColor: '#0b0b0f',
          }}
        >
          <img
            src={coverUrl}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.25) 78%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.72) 100%)',
            }}
          />
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: 72,
            }}
          >
            <div
              style={{
                alignSelf: 'flex-start',
                fontSize: 26,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.92)',
                background: 'rgba(0,0,0,0.28)',
                border: '1px solid rgba(255,255,255,0.14)',
                padding: '10px 16px',
                borderRadius: 999,
                marginBottom: 20,
              }}
            >
              <span style={{ color: '#f472b6' }}>SeichiGo</span>
            </div>
            <div
              style={{
                maxWidth: 980,
                fontSize: 76,
                fontWeight: 800,
                lineHeight: 1.06,
                letterSpacing: -0.5,
                color: 'rgba(255,255,255,0.98)',
                textShadow: '0 2px 14px rgba(0,0,0,0.60)',
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3,
              }}
            >
              {title}
            </div>
            {subtitle ? (
              <div
                style={{
                  maxWidth: 980,
                  fontSize: 32,
                  marginTop: 18,
                  color: 'rgba(255,255,255,0.88)',
                  textShadow: '0 2px 12px rgba(0,0,0,0.55)',
                  display: '-webkit-box',
                  overflow: 'hidden',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                }}
              >
                {subtitle}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: 'linear-gradient(135deg, #ffffff 0%, #fff1f2 45%, #ffe4e6 100%)',
            padding: 72,
            justifyContent: 'center',
          }}
        >
          <div style={{ color: '#db2777', fontSize: 32, fontWeight: 700, marginBottom: 24 }}>SeichiGo</div>
          <div
            style={{
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: -0.5,
              color: '#111827',
              display: '-webkit-box',
              overflow: 'hidden',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 30,
                color: '#6b7280',
                marginTop: 18,
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      )
    ),
    { ...size }
  )
}
