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
  'div',
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
  a: ['href', 'target', 'rel'],
  img: [
    'src',
    'alt',
    'data-align',
    'data-indent',
    'data-rotate',
    'data-flip-x',
    'data-flip-y',
    'data-crop-x',
    'data-crop-y',
    'data-natural-w',
    'data-natural-h',
    'style',
  ],
  figure: ['data-align', 'data-indent', 'data-figure-image', 'data-width-pct', 'style'],
  div: ['data-figure-image-container', 'data-figure-image-frame', 'data-mode', 'data-width-pct', 'data-crop-h', 'style'],
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

function sanitizeFrameStyle(style?: string): string | null {
  if (!style) return null
  let width: string | null = null
  let height: string | null = null
  let aspectRatio: string | null = null

  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const rawValue = part.slice(idx + 1).trim()
    if (!rawValue) continue

    if (prop === 'width') {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const n = Number(m[1])
      if (!Number.isFinite(n)) continue
      const clamped = Math.max(10, Math.min(100, n))
      width = `${Math.round(clamped)}%`
      continue
    }

    if (prop === 'height') {
      const m = /^(\d+)px$/.exec(rawValue)
      if (!m) continue
      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0) continue
      const clamped = Math.max(80, Math.min(2400, n))
      height = `${Math.trunc(clamped)}px`
      continue
    }

    if (prop === 'aspect-ratio') {
      const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(rawValue)
      if (!m) continue
      const a = Number(m[1])
      const b = Number(m[2])
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue
      aspectRatio = `${a} / ${b}`
    }
  }

  const parts: string[] = []
  if (width) parts.push(`width:${width}`)
  if (height) parts.push(`height:${height}`)
  if (aspectRatio) parts.push(`aspect-ratio:${aspectRatio}`)
  return parts.length ? parts.join(';') : null
}

function sanitizeContainerStyle(style?: string): string | null {
  if (!style) return null
  let width: string | null = null

  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const rawValue = part.slice(idx + 1).trim()
    if (!rawValue) continue

    if (prop === 'width') {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const n = Number(m[1])
      if (!Number.isFinite(n)) continue
      const clamped = Math.max(10, Math.min(100, n))
      width = `${Math.round(clamped)}%`
    }
  }

  return width ? `width:${width}` : null
}

function sanitizeImageVars(style?: string): string | null {
  if (!style) return null

  const allowedKeys = new Set([
    '--seichi-rot',
    '--seichi-flip-x',
    '--seichi-flip-y',
    '--seichi-w',
    '--seichi-h',
    '--seichi-pos',
  ])

  const out: Record<string, string> = {}

  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const rawValue = part.slice(idx + 1).trim()
    if (!rawValue) continue
    if (!allowedKeys.has(prop)) continue

    if (prop === '--seichi-rot') {
      const v = rawValue.toLowerCase()
      if (v === '0deg' || v === '90deg' || v === '180deg' || v === '270deg') out[prop] = v
      continue
    }

    if (prop === '--seichi-flip-x' || prop === '--seichi-flip-y') {
      const v = rawValue.trim()
      if (v === '1' || v === '-1') out[prop] = v
      continue
    }

    if (prop === '--seichi-w' || prop === '--seichi-h') {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0) continue
      const clamped = Math.max(1, Math.min(800, n))
      out[prop] = `${Math.round(clamped)}%`
      continue
    }

    if (prop === '--seichi-pos') {
      const m = /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const x = Number(m[1])
      const y = Number(m[2])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const cx = Math.max(0, Math.min(100, x))
      const cy = Math.max(0, Math.min(100, y))
      out[prop] = `${Math.round(cx)}% ${Math.round(cy)}%`
    }
  }

  const parts: string[] = []
  for (const key of ['--seichi-rot', '--seichi-flip-x', '--seichi-flip-y', '--seichi-w', '--seichi-h', '--seichi-pos']) {
    const value = out[key]
    if (value) parts.push(`${key}:${value}`)
  }
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
      if (frame.tag === 'div') {
        const isFrame = String(frame.attribs?.['data-figure-image-frame'] || '').trim().toLowerCase() === 'true'
        const isContainer = String(frame.attribs?.['data-figure-image-container'] || '').trim().toLowerCase() === 'true'
        return !isFrame && !isContainer
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
      figure: (tagName, attribs) => {
        const next = sanitizeBlockAttrs(attribs)

        const marker = String(attribs['data-figure-image'] || '').trim().toLowerCase()
        if (marker !== 'true') return { tagName, attribs: next }

        next['data-figure-image'] = 'true'

        const widthPct = sanitizePercentInt(attribs['data-width-pct'], 10, 100)
        if (widthPct) next['data-width-pct'] = widthPct

        const style = sanitizeContainerStyle(attribs.style) || (widthPct ? `width:${widthPct}%` : null)
        if (style) next.style = style

        return { tagName, attribs: next }
      },
      figcaption: (tagName) => ({ tagName, attribs: {} }),
      div: (tagName, attribs) => {
        const next: Record<string, string> = {}

        const markerContainer = String(attribs['data-figure-image-container'] || '').trim().toLowerCase()
        if (markerContainer === 'true') {
          next['data-figure-image-container'] = 'true'
          const widthPct = sanitizePercentInt(attribs['data-width-pct'], 10, 100)
          if (widthPct) next['data-width-pct'] = widthPct

          const style = sanitizeContainerStyle(attribs.style) || (widthPct ? `width:${widthPct}%` : null)
          if (style) next.style = style
          return { tagName, attribs: next }
        }

        const markerFrame = String(attribs['data-figure-image-frame'] || '').trim().toLowerCase()
        if (markerFrame !== 'true') {
          return { tagName, attribs: {} }
        }

        next['data-figure-image-frame'] = 'true'

        const mode = String(attribs['data-mode'] || '').trim().toLowerCase()
        if (mode === 'plain' || mode === 'transform') next['data-mode'] = mode

        const widthPct = sanitizePercentInt(attribs['data-width-pct'], 10, 100)
        if (widthPct) next['data-width-pct'] = widthPct

        const cropH = sanitizePercentInt(attribs['data-crop-h'], 80, 2400)
        if (cropH) next['data-crop-h'] = cropH

        const style = sanitizeFrameStyle(attribs.style)
        if (style) next.style = style
        return { tagName, attribs: next }
      },
      a: (tagName, attribs) => {
        const href = sanitizeAnchorHref(attribs.href)
        const next: Record<string, string> = {}
        if (href) {
          next.href = href
          const openInNewTab = /^https?:\/\//i.test(href) || href.startsWith('/')
          if (openInNewTab) {
            next.target = '_blank'
            next.rel = 'noopener noreferrer'
          }
        }
        return { tagName, attribs: next }
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = sanitizeBlockAttrs(attribs)
        if (attribs.src) next.src = attribs.src.trim()
        if (attribs.alt) next.alt = String(attribs.alt)
        for (const key of ['data-rotate', 'data-flip-x', 'data-flip-y', 'data-crop-x', 'data-crop-y', 'data-natural-w', 'data-natural-h']) {
          const v = String((attribs as any)[key] || '').trim()
          if (v) next[key] = v
        }
        const style = sanitizeImageVars(attribs.style)
        if (style) next.style = style
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

function sanitizePercentInt(value: unknown, min: number, max: number): string | null {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return String(Math.trunc(n))
}

function sanitizeBlockAttrs(attribs: Record<string, string | undefined>): Record<string, string> {
  const next: Record<string, string> = {}
  const align = sanitizeAlign(attribs['data-align'])
  if (align) next['data-align'] = align
  const indent = sanitizeIndent(attribs['data-indent'])
  if (indent) next['data-indent'] = indent
  return next
}
