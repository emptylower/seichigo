import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'
import PostMeta from '@/components/blog/PostMeta'
import GiscusComments from '@/components/GiscusComments'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  const posts = await getAllPosts('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return { title: '文章已下架' }
    }
    return { title: '未找到文章' }
  }
  const frontmatter =
    found.source === 'mdx'
      ? found.post.frontmatter
      : {
          title: found.article.title,
          slug: `${found.article.id}-${found.article.slug}`,
          animeId: found.article.animeIds?.[0] || 'unknown',
          city: found.article.city || '',
        }
  return {
    title: `${frontmatter.title}`,
    description: `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim(),
    openGraph: {
      type: 'article',
      title: frontmatter.title,
      description: `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim(),
      url: `/posts/${frontmatter.slug}`,
    },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return <div className="text-gray-500">文章已下架。</div>
    }
    return <div className="text-gray-500">文章未找到。</div>
  }

  if (found.source === 'db') {
    const canonical = `${found.article.id}-${found.article.slug}`
    if (slug !== canonical) {
      redirect(`/posts/${canonical}`)
    }
  }

  const title = found.source === 'mdx' ? found.post.frontmatter.title : found.article.title
  const city = found.source === 'mdx' ? found.post.frontmatter.city : found.article.city || ''
  const routeLength = found.source === 'mdx' ? found.post.frontmatter.routeLength : found.article.routeLength || undefined
  const publishDate =
    found.source === 'mdx'
      ? found.post.frontmatter.publishDate
      : found.article.publishedAt
        ? found.article.publishedAt.toISOString().slice(0, 10)
        : undefined

  const animeIds =
    found.source === 'mdx'
      ? [found.post.frontmatter.animeId].filter(Boolean)
      : (found.article.animeIds as string[]) || []

  const giscusTerm = found.source === 'db' ? found.article.id : found.post.frontmatter.slug
  return (
    <article className="prose prose-pink max-w-none">
      <h1>{title}</h1>
      <PostMeta animeIds={animeIds} city={city} routeLength={routeLength} publishDate={publishDate} />
      <div className="mt-6" />
      {found.source === 'mdx' ? (
        found.post.content
      ) : (
        <div dangerouslySetInnerHTML={{ __html: found.article.contentHtml || '' }} />
      )}
      <div className="mt-12" />
      <GiscusComments term={giscusTerm} />
    </article>
  )
}
