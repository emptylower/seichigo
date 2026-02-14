"use client"

import type { ArticleComposerInitial } from '../../_components/ArticleComposerClient'
import ArticleComposerLazy from '../../_components/ArticleComposerLazy'

export default function RevisionEditClient({ initial }: { initial: ArticleComposerInitial }) {
  return <ArticleComposerLazy initial={initial} mode="revision" />
}
