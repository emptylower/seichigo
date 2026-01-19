import { compileMDX } from 'next-mdx-remote/rsc'
import { mdxComponents } from '@/lib/mdx/mdxComponents'
import { readLinkAssetMarkdown } from '@/lib/linkAsset/content'
import type { LinkAsset } from '@/lib/linkAsset/types'

type Props = {
  asset: LinkAsset
}

export default async function EtiquetteAssetView({ asset }: Props) {
  const source = await readLinkAssetMarkdown(asset.contentFile)
  if (!source) return null

  const compiled = await compileMDX({
    source,
    components: mdxComponents,
  })

  return <div className="prose prose-pink max-w-none">{compiled.content}</div>
}
