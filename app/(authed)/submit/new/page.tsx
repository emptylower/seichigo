import { getServerAuthSession } from '@/lib/auth/session'
import ArticleComposerClient from '../_components/ArticleComposerClient'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '新建文章',
  description: '创建一篇新的圣地巡礼攻略文章。',
  alternates: { canonical: '/submit/new' },
}
export const dynamic = 'force-dynamic'

export default async function NewArticlePage() {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">新建文章</h1>
        <p className="text-gray-600">请先登录后再进行创作与投稿。</p>
        <a className="btn-primary inline-flex w-fit" href="/auth/signin?callbackUrl=%2Fsubmit%2Fnew">
          去登录
        </a>
      </div>
    )
  }

  return <ArticleComposerClient initial={null} />
}
