import sanitizeHtml from 'sanitize-html'
import { RICH_TEXT_ALLOWED_COLORS } from './palette'
import { RICH_TEXT_ALLOWED_FONT_FAMILIES } from './fonts'

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'p',
  'br',
  'blockquote',
  'strong',
  'em',
  'u',
  's',
  'del',
  'code',
  'span',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'pre',
  'img',
  'figure',
  'figcaption',
]

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'data-align', 'data-indent'],
  figure: ['data-align', 'data-indent'],
  p: ['data-align', 'data-indent'],
  h1: ['data-align', 'data-indent'],
  h2: ['data-align', 'data-indent'],
  h3: ['data-align', 'data-indent'],
  blockquote: ['data-align', 'data-indent'],
  pre: ['data-align', 'data-indent'],
  ul: ['data-align', 'data-indent'],
  ol: ['data-align', 'data-indent'],
  li: ['data-align', 'data-indent'],
  span: ['style'],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
}

const allowedColors = new Set(RICH_TEXT_ALLOWED_COLORS.map((c) => c.toLowerCase()))
const allowedFonts = new Set(RICH_TEXT_ALLOWED_FONT_FAMILIES.map((f) => normalizeFontFamily(f)))

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  if (!/^#[0-9a-f]{3}$/.test(trimmed)) return null
  const r = trimmed[1]!
  const g = trimmed[2]!
  const b = trimmed[3]!
  return `#${r}${r}${g}${g}${b}${b}`
}

function normalizeFontFamily(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .toLowerCase()
}

function sanitizeFontFamily(value: string): string | null {
  const parts = value
    .split(',')
    .map((x) => normalizeFontFamily(x))
    .filter(Boolean)
  if (!parts.length) return null
  if (parts.some((p) => !allowedFonts.has(p))) return null
  return parts.map(formatFontFamily).join(',')
}

function formatFontFamily(normalized: string): string {
  if (/^[a-z0-9-]+$/.test(normalized)) return normalized
  const safe = normalized.replaceAll('"', '')
  return `"${safe}"`
}

function sanitizeSpanStyle(style?: string): string | null {
  if (!style) return null
  let color: string | null = null
  let backgroundColor: string | null = null
  let fontFamily: string | null = null

  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const rawValue = part.slice(idx + 1).trim()
    if (!rawValue) continue

    if (prop === 'color') {
      const normalized = normalizeHexColor(rawValue)
      if (normalized && allowedColors.has(normalized)) color = normalized
      continue
    }

    if (prop === 'background-color') {
      const normalized = normalizeHexColor(rawValue)
      if (normalized && allowedColors.has(normalized)) backgroundColor = normalized
      continue
    }

    if (prop === 'font-family') {
      const normalized = sanitizeFontFamily(rawValue)
      if (normalized) fontFamily = normalized
    }
  }

  const parts: string[] = []
  if (color) parts.push(`color:${color}`)
  if (backgroundColor) parts.push(`background-color:${backgroundColor}`)
  if (fontFamily) parts.push(`font-family:${fontFamily}`)
  return parts.length ? parts.join(';') : null
}

function isAllowedImageSrc(src: string): boolean {
  const trimmed = src.trim()
  if (/^https?:\/\//i.test(trimmed)) return true
  return /^\/assets\/[a-zA-Z0-9_-]+$/.test(trimmed)
}

function sanitizeAnchorHref(href?: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('//')) return null

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase()
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return trimmed
    return null
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed
  return null
}

export function sanitizeRichTextHtml(inputHtml: string): string {
  if (!inputHtml) return ''

  return sanitizeHtml(inputHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    nonTextTags: ['script', 'style', 'textarea', 'noscript'],
    exclusiveFilter(frame) {
      if (frame.tag === 'img') {
        return !isAllowedImageSrc(frame.attribs?.src || '')
      }
      return false
    },
    transformTags: {
      h1: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      h2: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      h3: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      p: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      blockquote: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      pre: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      ul: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      ol: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      li: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      figure: (tagName, attribs) => ({ tagName, attribs: sanitizeBlockAttrs(attribs) }),
      figcaption: (tagName) => ({ tagName, attribs: {} }),
      a: (tagName, attribs) => {
        const next = { ...attribs }
        const href = sanitizeAnchorHref(attribs.href)
        if (href) next.href = href
        else delete next.href
        return { tagName, attribs: next }
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = sanitizeBlockAttrs(attribs)
        if (attribs.src) next.src = attribs.src.trim()
        if (attribs.alt) next.alt = String(attribs.alt)
        return { tagName, attribs: next }
      },
      span: (tagName, attribs) => {
        const next = { ...attribs }
        const style = sanitizeSpanStyle(attribs.style)
        if (style) next.style = style
        else delete next.style
        return { tagName, attribs: next }
      },
    },
  })
}

function sanitizeAlign(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw || raw === 'left') return null
  if (raw === 'center' || raw === 'right') return raw
  return null
}

function sanitizeIndent(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return String(Math.min(6, Math.trunc(n)))
}

function sanitizeBlockAttrs(attribs: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {}
  const align = sanitizeAlign(attribs['data-align'])
  if (align) next['data-align'] = align
  const indent = sanitizeIndent(attribs['data-indent'])
  if (indent) next['data-indent'] = indent
  return next
}
