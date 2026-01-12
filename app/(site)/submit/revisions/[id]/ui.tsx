"use client"

import ArticleComposerClient, { type ArticleComposerInitial } from '../../_components/ArticleComposerClient'

export default function RevisionEditClient({ initial }: { initial: ArticleComposerInitial }) {
  return <ArticleComposerClient initial={initial} mode="revision" />
}

