import type { Metadata } from 'next'
import PostsIndexTemplate from '@/components/posts/PostsIndexTemplate'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildJaAlternates } from '@/lib/seo/alternates'

const TITLE = '巡礼ガイド｜アニメ聖地巡礼ルートまとめ'
const DESCRIPTION =
  '公開済みのアニメ聖地巡礼ガイドの全一覧（新しい順）。ロケ地リスト、ルートマップ、撮影スポットのヒント、ナビ導線をまとめて確認できます。'

export function generateMetadata(): Metadata {
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: buildJaAlternates({ zhPath: '/posts' }),
    openGraph: { type: 'website', url: '/ja/posts', title: TITLE, description: DESCRIPTION, images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/twitter-image'] },
  }
}

export const revalidate = 120
export const dynamic = 'force-static'

export default async function PostsIndexJaPage() {
  const posts = await getAllPublicPosts('ja')
  return <PostsIndexTemplate locale="ja" items={posts.filter((p) => !isSeoSpokePost(p))} />
}
