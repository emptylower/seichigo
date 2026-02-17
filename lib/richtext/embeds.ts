import { parseSeichiRouteEmbedV1 } from '@/lib/route/schema'
import { renderSeichiRouteEmbedHtml } from '@/lib/route/render'
import { t } from '@/lib/i18n'
import type { SupportedLocale } from '@/lib/i18n/types'

const SEICHI_ROUTE_TAG_RE = /<seichi-route\b[^>]*?(?:\/>|>\s*<\/seichi-route>)/gi
const DATA_ID_RE = /\bdata-id\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i
const FIRST_HEADING_RE = /<h[1-3]\b[^>]*>/i
const FIRST_PARAGRAPH_CLOSE_RE = /<\/p>/i

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

function renderRouteByData(id: string, raw: unknown, locale: SupportedLocale): string {
  const parsed = parseSeichiRouteEmbedV1(raw)
  if (!parsed.ok) {
    return `<section class="seichi-route seichi-route--invalid" data-id="${id}">${t('route.embed.formatError', locale)}${parsed.error}</section>`
  }
  return renderSeichiRouteEmbedHtml(parsed.value, { id, locale })
}

function pickNextUnrenderedRouteId(orderedIds: string[], renderedIds: Set<string>): string | null {
  for (const id of orderedIds) {
    if (!renderedIds.has(id)) return id
  }
  return null
}

function insertAfterLead(html: string, injection: string): string {
  if (!injection) return html

  const heading = FIRST_HEADING_RE.exec(html)
  if (heading && heading.index > 0) {
    return `${html.slice(0, heading.index)}${injection}${html.slice(heading.index)}`
  }

  const firstParagraphClose = FIRST_PARAGRAPH_CLOSE_RE.exec(html)
  if (firstParagraphClose) {
    const idx = firstParagraphClose.index + firstParagraphClose[0].length
    return `${html.slice(0, idx)}${injection}${html.slice(idx)}`
  }

  return `${injection}${html}`
}

export function renderRichTextEmbeds(inputHtml: string, contentJson: unknown | null | undefined, locale: SupportedLocale = 'zh'): string {
  const html = String(inputHtml || '')
  if (!html) return ''

  const routes = new Map<string, unknown>()
  collectSeichiRouteNodes(contentJson, routes)
  if (!routes.size) return html

  const orderedRouteIds = Array.from(routes.keys())
  const renderedIds = new Set<string>()

  const replaced = html.replace(SEICHI_ROUTE_TAG_RE, (tag) => {
    const id = extractDataIdFromTag(tag)
    const preferredId = id && routes.has(id) ? id : null
    const resolvedId = preferredId || pickNextUnrenderedRouteId(orderedRouteIds, renderedIds)
    if (!resolvedId) {
      if (!id) {
        return `<section class="seichi-route seichi-route--invalid" data-id="">${t('route.embed.missingDataId', locale)}</section>`
      }
      return `<section class="seichi-route seichi-route--invalid" data-id="${id}">${t('route.embed.dataNotFound', locale)}</section>`
    }

    renderedIds.add(resolvedId)
    return renderRouteByData(resolvedId, routes.get(resolvedId), locale)
  })

  const missing: string[] = []
  for (const [id, raw] of routes) {
    if (renderedIds.has(id)) continue
    missing.push(renderRouteByData(id, raw, locale))
  }

  if (!missing.length) return replaced
  return insertAfterLead(replaced, missing.join(''))
}
