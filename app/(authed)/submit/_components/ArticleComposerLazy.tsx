'use client'

import dynamic from 'next/dynamic'
import type { ArticleComposerInitial } from './ArticleComposerClient'

const ArticleComposerClient = dynamic(() => import('./ArticleComposerClient'), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex w-full max-w-5xl gap-8 px-4 py-10">
      <div className="hidden shrink-0 lg:block">
        <div className="h-24 w-64 rounded-md border border-gray-100 bg-gray-50" />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <a href="/submit" className="text-sm text-gray-500 hover:text-gray-700">
            返回草稿箱
          </a>
          <span className="inline-block min-w-[4.5rem] text-right text-xs text-gray-500">加载中…</span>
        </div>
        <h1 className="line-clamp-1 text-4xl font-bold tracking-tight text-gray-900">编辑器加载中…</h1>
        <div className="min-h-[30rem] rounded-md border bg-gray-50" />
      </div>
    </div>
  ),
})

export default function ArticleComposerLazy({
  initial,
  mode,
}: {
  initial: ArticleComposerInitial | null
  mode?: 'article' | 'revision'
}) {
  return <ArticleComposerClient initial={initial} mode={mode} />
}
