import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPostBySlug } from '@/lib/mdx/getPostBySlug'
import PostMeta from '@/components/blog/PostMeta'
import GiscusComments from '@/components/GiscusComments'
import type { Metadata } from 'next'

export async function generateStaticParams() {
  const posts = await getAllPosts('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug, 'zh')
  if (!post) return { title: '未找到文章' }
  const { frontmatter } = post
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
  const post = await getPostBySlug(slug, 'zh')
  if (!post) return <div className="text-gray-500">文章未找到。</div>
  const { frontmatter, content } = post
  return (
    <article className="prose prose-pink max-w-none">
      <h1>{frontmatter.title}</h1>
      <PostMeta animeId={frontmatter.animeId} city={frontmatter.city} routeLength={frontmatter.routeLength} publishDate={frontmatter.publishDate} />
      <div className="mt-6" />
      {content}
      <div className="mt-12" />
      <GiscusComments term={frontmatter.slug} />
    </article>
  )
}
