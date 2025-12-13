import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import PostMeta from '@/components/blog/PostMeta'
import GiscusComments from '@/components/GiscusComments'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateStaticParams() {
  const posts = await getAllPosts('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) return { title: '未找到文章' }
  const frontmatter =
    found.source === 'mdx'
      ? found.post.frontmatter
      : {
          title: found.article.title,
          slug: found.article.slug,
          animeId: found.article.animeId || 'unknown',
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
  if (!found) return <div className="text-gray-500">文章未找到。</div>

  const frontmatter =
    found.source === 'mdx'
      ? found.post.frontmatter
      : {
          title: found.article.title,
          slug: found.article.slug,
          animeId: found.article.animeId || 'unknown',
          city: found.article.city || '',
          routeLength: found.article.routeLength || undefined,
          publishDate: found.article.publishedAt ? found.article.publishedAt.toISOString().slice(0, 10) : undefined,
        }
  return (
    <article className="prose prose-pink max-w-none">
      <h1>{frontmatter.title}</h1>
      <PostMeta animeId={frontmatter.animeId} city={frontmatter.city} routeLength={frontmatter.routeLength} publishDate={frontmatter.publishDate} />
      <div className="mt-6" />
      {found.source === 'mdx' ? (
        found.post.content
      ) : (
        <div dangerouslySetInnerHTML={{ __html: found.article.contentHtml || '' }} />
      )}
      <div className="mt-12" />
      <GiscusComments term={frontmatter.slug} />
    </article>
  )
}
