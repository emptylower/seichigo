import type { Metadata } from 'next'
import PostsIndexTemplate from '@/components/posts/PostsIndexTemplate'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildEnAlternates } from '@/lib/seo/alternates'

const TITLE = 'Pilgrimage Guides | Anime Pilgrimage Routes and Walkthroughs'
const DESCRIPTION =
  'Every published anime pilgrimage guide, newest first: filming location lists, route maps, photo-spot tips, and navigation links for planning your trip to Japan.'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: buildEnAlternates({ zhPath: '/posts' }),
    openGraph: { type: 'website', url: '/en/posts', title: TITLE, description: DESCRIPTION, images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/twitter-image'] },
  }
}

export const revalidate = 120
export const dynamic = 'force-static'

export default async function PostsIndexEnPage() {
  const posts = await getAllPublicPosts('en')
  return <PostsIndexTemplate locale="en" items={posts.filter((p) => !isSeoSpokePost(p))} />
}
