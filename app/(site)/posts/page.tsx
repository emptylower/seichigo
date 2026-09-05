import type { Metadata } from 'next'
import PostsIndexTemplate from '@/components/posts/PostsIndexTemplate'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildZhAlternates } from '@/lib/seo/alternates'

const TITLE = '巡礼攻略｜动漫圣地巡礼路线与攻略全集'
const DESCRIPTION =
  '已发布的动漫圣地巡礼攻略全集：按发布时间倒序浏览每条巡礼路线的取景地清单、机位建议与地图导航入口，挑一篇就能开始规划行程。'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: buildZhAlternates({ path: '/posts' }),
    openGraph: { type: 'website', url: '/posts', title: TITLE, description: DESCRIPTION, images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/twitter-image'] },
  }
}

export const revalidate = 120
export const dynamic = 'force-static'

export default async function PostsIndexPage() {
  const posts = await getAllPublicPosts('zh')
  return <PostsIndexTemplate locale="zh" items={posts.filter((p) => !isSeoSpokePost(p))} />
}
