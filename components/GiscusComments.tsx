"use client"
import Giscus from '@giscus/react'

type Props = {
  term: string
}

export default function GiscusComments({ term }: Props) {
  const repo = (process.env.NEXT_PUBLIC_GISCUS_REPO || '') as `${string}/${string}`
  const repoId = process.env.NEXT_PUBLIC_GISCUS_REPO_ID || ''
  const category = process.env.NEXT_PUBLIC_GISCUS_CATEGORY || ''
  const categoryId = process.env.NEXT_PUBLIC_GISCUS_CATEGORY_ID || ''

  if (!repo || !repoId || !category || !categoryId) {
    return null
  }

  return (
    <div className="mt-10">
      <Giscus
        repo={repo}
        repoId={repoId}
        category={category}
        categoryId={categoryId}
        mapping="specific"
        term={term}
        reactionsEnabled="1"
        emitMetadata="0"
        inputPosition="bottom"
        theme="light"
        lang="zh-CN"
        loading="lazy"
      />
    </div>
  )
}
