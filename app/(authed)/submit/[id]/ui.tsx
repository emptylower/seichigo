import type { ArticleComposerInitial } from '../_components/ArticleComposerClient'
import ArticleComposerLazy from '../_components/ArticleComposerLazy'

export default function SubmitEditClient({ initial }: { initial: ArticleComposerInitial }) {
  return <ArticleComposerLazy initial={initial} />
}
