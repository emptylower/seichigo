import { ImageResponse } from 'next/og'
import { getPostBySlug } from '@/lib/mdx/getPostBySlug'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPostBySlug(slug, 'zh')
  const title = post?.frontmatter.title || 'SeichiGo'
  const subtitle = [post?.frontmatter.animeId, post?.frontmatter.city].filter(Boolean).join(' · ')
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          padding: 64,
          justifyContent: 'center',
        }}
      >
        <div style={{ color: '#db2777', fontSize: 32, marginBottom: 24 }}>SeichiGo</div>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        <div style={{ fontSize: 28, color: '#6b7280', marginTop: 16 }}>{subtitle}</div>
      </div>
    ),
    { ...size }
  )
}
