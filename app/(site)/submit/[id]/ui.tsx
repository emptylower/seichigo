"use client"

import ArticleComposerClient, { type ArticleComposerInitial } from '../_components/ArticleComposerClient'

export default function SubmitEditClient({ initial }: { initial: ArticleComposerInitial }) {
  return <ArticleComposerClient initial={initial} />
}

