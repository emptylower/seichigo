import { parseSeichiRouteEmbedV1, type SeichiRouteEmbedV1 } from './schema'

export type SeichiRouteEmbedInDoc = {
  id: string
  route: SeichiRouteEmbedV1
}

function walkTipTapJson(node: any, out: SeichiRouteEmbedInDoc[], seen: Set<string>) {
  if (!node || typeof node !== 'object') return

  if (node.type === 'seichiRoute') {
    const attrs = node.attrs as any
    const id = typeof attrs?.id === 'string' ? attrs.id.trim() : ''
    if (id && !seen.has(id)) {
      const parsed = parseSeichiRouteEmbedV1(attrs?.data)
      if (parsed.ok) {
        out.push({ id, route: parsed.value })
        seen.add(id)
      }
    }
  }

  const content = node.content
  if (Array.isArray(content)) {
    for (const child of content) {
      walkTipTapJson(child, out, seen)
    }
  }
}

export function extractSeichiRouteEmbedsFromTipTapJson(contentJson: unknown | null | undefined): SeichiRouteEmbedInDoc[] {
  const out: SeichiRouteEmbedInDoc[] = []
  const seen = new Set<string>()
  walkTipTapJson(contentJson as any, out, seen)
  return out
}

