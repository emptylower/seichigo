import { parseSeichiRouteEmbedV1 } from '@/lib/route/schema'
import { renderSeichiRouteEmbedHtml } from '@/lib/route/render'

const SEICHI_ROUTE_TAG_RE = /<seichi-route\b[^>]*?(?:\/>|>\s*<\/seichi-route>)/gi
const DATA_ID_RE = /\bdata-id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i

function extractDataIdFromTag(tag: string): string | null {
  const m = DATA_ID_RE.exec(tag)
  const raw = (m?.[1] || m?.[2] || m?.[3] || '').trim()
  return raw ? raw : null
}

function collectSeichiRouteNodes(node: any, out: Map<string, unknown>) {
  if (!node || typeof node !== 'object') return

  if (node.type === 'seichiRoute') {
    const attrs = (node as any).attrs as any
    const id = typeof attrs?.id === 'string' ? attrs.id.trim() : ''
    if (id) out.set(id, attrs?.data)
  }

  const content = (node as any).content
  if (Array.isArray(content)) {
    for (const child of content) collectSeichiRouteNodes(child, out)
  }
}

export function renderRichTextEmbeds(inputHtml: string, contentJson: unknown | null | undefined): string {
  const html = String(inputHtml || '')
  if (!html) return ''
  if (!html.toLowerCase().includes('seichi-route')) return html

  const routes = new Map<string, unknown>()
  collectSeichiRouteNodes(contentJson, routes)
  if (!routes.size) return html

  return html.replace(SEICHI_ROUTE_TAG_RE, (tag) => {
     const id = extractDataIdFromTag(tag)
     if (!id) {
       return '<section class="seichi-route seichi-route--invalid" data-id="">路线数据缺少 data-id（请发起更新并重新发布）。</section>'
     }
     const raw = routes.get(id)
     if (raw === undefined) {
       return `<section class="seichi-route seichi-route--invalid" data-id="${id}">路线数据未找到（请发起更新并重新发布）。</section>`
     }
     const parsed = parseSeichiRouteEmbedV1(raw)
     if (!parsed.ok) {
       return `<section class="seichi-route seichi-route--invalid" data-id="${id}">路线数据格式错误：${parsed.error}</section>`
     }
    return renderSeichiRouteEmbedHtml(parsed.value, { id })
  })
}

