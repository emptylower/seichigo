import { readLinkAssetContentHtml } from '@/lib/linkAsset/content'
import type { LinkAsset } from '@/lib/linkAsset/types'

type Props = {
  asset: LinkAsset
}

export default async function EtiquetteAssetView({ asset }: Props) {
  const contentHtml = await readLinkAssetContentHtml(asset.contentFile)
  if (!contentHtml) return null

  return <div className="prose prose-pink max-w-none" dangerouslySetInnerHTML={{ __html: contentHtml }} />
}
