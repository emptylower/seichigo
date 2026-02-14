'use client'

import dynamic from 'next/dynamic'
import type { ArticleComposerInitial } from './ArticleComposerClient'

const ArticleComposerClient = dynamic(() => import('./ArticleComposerClient'), {
  ssr: false,
  loading: () => (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="space-y-4">
        <div className="h-6 w-24 rounded bg-gray-100" />
        <div className="h-12 w-3/5 rounded bg-gray-100" />
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
