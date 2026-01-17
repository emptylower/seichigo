import sanitizeHtml from 'sanitize-html'
import { RICH_TEXT_ALLOWED_FONT_FAMILIES } from './fonts'

export type SanitizeRichTextOptions = {
  imageMode?: 'default' | 'progressive'
}

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
  'seichi-route',
  'seichi-callout',
]

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: [
    'src',
    'alt',
    'loading',
    'decoding',
    'data-align',
    'data-indent',
    'data-rotate',
    'data-flip-x',
    'data-flip-y',
    'data-crop-l',
    'data-crop-t',
    'data-crop-r',
    'data-crop-b',
    'data-natural-w',
    'data-natural-h',
    'data-seichi-full',
    'data-seichi-sd',
    'data-seichi-hd',
    'data-seichi-blur',
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
  'seichi-route': ['data-id'],
  'seichi-callout': [],
}

const allowedFonts = new Set(RICH_TEXT_ALLOWED_FONT_FAMILIES.map((f) => normalizeFontFamily(f)))

function clampByte(input: number): number {
  if (!Number.isFinite(input)) return 0
  return Math.max(0, Math.min(255, Math.round(input)))
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

function normalizeCssColorToHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  if (!/^#[0-9a-f]{3}$/.test(trimmed)) return null
  const r = trimmed[1]!
  const g = trimmed[2]!
  const b = trimmed[3]!
  return `#${r}${r}${g}${g}${b}${b}`
}

function normalizeCssColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  const hex = normalizeCssColorToHex(trimmed)
  if (hex) return hex

  const comma = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+%?))?\s*\)$/.exec(trimmed)
  const space = /^rgba?\(\s*([0-9]{1,3})\s+([0-9]{1,3})\s+([0-9]{1,3})(?:\s*\/\s*([0-9.]+%?))?\s*\)$/.exec(trimmed)
  const match = comma || space
  if (!match) return null

  const alphaRaw = match[4]
  if (alphaRaw) {
    const a = alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw)
    if (!Number.isFinite(a) || a < 1) return null
  }

  const r = clampByte(Number(match[1]))
  const g = clampByte(Number(match[2]))
  const b = clampByte(Number(match[3]))
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
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
      const normalized = normalizeCssColor(rawValue)
      if (normalized) color = normalized
      continue
    }

    if (prop === 'background-color') {
      const normalized = normalizeCssColor(rawValue)
      if (normalized) backgroundColor = normalized
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
    '--seichi-crop-left',
    '--seichi-crop-top',
    '--seichi-crop-width',
    '--seichi-crop-height',
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

    if (prop === '--seichi-crop-left' || prop === '--seichi-crop-top') {
      const m = /^-?(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const n = Number(rawValue.replace('%', ''))
      if (!Number.isFinite(n)) continue
      const clamped = Math.max(-2000, Math.min(2000, n))
      out[prop] = `${Math.round(clamped)}%`
      continue
    }

    if (prop === '--seichi-crop-width' || prop === '--seichi-crop-height') {
      const m = /^(\d+(?:\.\d+)?)%$/.exec(rawValue)
      if (!m) continue
      const n = Number(m[1])
      if (!Number.isFinite(n) || n <= 0) continue
      const clamped = Math.max(1, Math.min(2000, n))
      out[prop] = `${Math.round(clamped)}%`
    }
  }

  const parts: string[] = []
  for (const key of [
    '--seichi-rot',
    '--seichi-flip-x',
    '--seichi-flip-y',
    '--seichi-w',
    '--seichi-h',
    '--seichi-pos',
    '--seichi-crop-left',
    '--seichi-crop-top',
    '--seichi-crop-width',
    '--seichi-crop-height',
  ]) {
    const value = out[key]
    if (value) parts.push(`${key}:${value}`)
  }
  return parts.length ? parts.join(';') : null
}

function isAllowedImageSrc(src: string): boolean {
  const trimmed = src.trim()
  if (/^https?:\/\//i.test(trimmed)) return true

  const match = /^\/assets\/[a-zA-Z0-9_-]+(?:\?.*)?$/.exec(trimmed)
  if (!match) return false
  if (!trimmed.includes('?')) return true

  try {
    const url = new URL(trimmed, 'https://example.com')
    for (const key of url.searchParams.keys()) {
      if (key !== 'w' && key !== 'q') return false
    }
    const w = url.searchParams.get('w')
    const q = url.searchParams.get('q')
    if (w && !/^\d+$/.test(w)) return false
    if (q && !/^\d+$/.test(q)) return false
    return true
  } catch {
    return false
  }
}

function isTruthyMarker(value: unknown): boolean {
  if (value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'true' || s === ''
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

export function sanitizeRichTextHtml(inputHtml: string, options?: SanitizeRichTextOptions): string {
  if (!inputHtml) return ''

  const sanitized = sanitizeHtml(inputHtml, {
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
        const isFrame = isTruthyMarker(frame.attribs?.['data-figure-image-frame'])
        const isContainer = isTruthyMarker(frame.attribs?.['data-figure-image-container'])
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

        if (!isTruthyMarker(attribs['data-figure-image'])) return { tagName, attribs: next }

        next['data-figure-image'] = 'true'

        const widthPctFromAttr = sanitizePercentInt(attribs['data-width-pct'], 10, 100)
        const widthPctFromStyle = (() => {
          const style = sanitizeContainerStyle(attribs.style)
          if (!style) return null
          const m = /\bwidth\s*:\s*(\d+)%/i.exec(style)
          return m ? String(Math.max(10, Math.min(100, Number(m[1])))) : null
        })()
        const widthPct = widthPctFromAttr || widthPctFromStyle || '100'
        next['data-width-pct'] = widthPct
        next.style = `--seichi-width-pct:${widthPct};width:${widthPct}%`

        return { tagName, attribs: next }
      },
      figcaption: (tagName) => ({ tagName, attribs: {} }),
      div: (tagName, attribs) => {
        const next: Record<string, string> = {}

        if (isTruthyMarker(attribs['data-figure-image-container'])) {
          next['data-figure-image-container'] = 'true'
          const widthPct = sanitizePercentInt(attribs['data-width-pct'], 10, 100)
          if (widthPct) next['data-width-pct'] = widthPct
          return { tagName, attribs: next }
        }

        if (!isTruthyMarker(attribs['data-figure-image-frame'])) {
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
        const src = typeof attribs.src === 'string' ? attribs.src.trim() : ''
        if (src) {
          const rewrite = rewriteAssetImageSrc(src, options)
          if (rewrite) {
            next.src = rewrite.placeholder
            next['data-seichi-full'] = rewrite.full
            next['data-seichi-sd'] = rewrite.sd
            next['data-seichi-hd'] = rewrite.hd
            next['data-seichi-blur'] = 'true'
            next.loading = 'lazy'
            next.decoding = 'async'
          } else {
            next.src = src
          }
        }
        if (attribs.alt) next.alt = String(attribs.alt)
        const rotate = sanitizePercentInt(attribs['data-rotate'], 0, 360)
        if (rotate) next['data-rotate'] = rotate
        const flipX = sanitizePercentInt(attribs['data-flip-x'], 0, 1)
        if (flipX) next['data-flip-x'] = flipX
        const flipY = sanitizePercentInt(attribs['data-flip-y'], 0, 1)
        if (flipY) next['data-flip-y'] = flipY
        const cropL = sanitizePercentInt(attribs['data-crop-l'], 0, 95)
        if (cropL) next['data-crop-l'] = cropL
        const cropT = sanitizePercentInt(attribs['data-crop-t'], 0, 95)
        if (cropT) next['data-crop-t'] = cropT
        const cropR = sanitizePercentInt(attribs['data-crop-r'], 0, 95)
        if (cropR) next['data-crop-r'] = cropR
        const cropB = sanitizePercentInt(attribs['data-crop-b'], 0, 95)
        if (cropB) next['data-crop-b'] = cropB
        const naturalW = sanitizePercentInt(attribs['data-natural-w'], 0, 200000)
        if (naturalW) next['data-natural-w'] = naturalW
        const naturalH = sanitizePercentInt(attribs['data-natural-h'], 0, 200000)
        if (naturalH) next['data-natural-h'] = naturalH
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

  // Remove whitespace text nodes between adjacent figure blocks so inline-block figure images
  // don't create an extra "space gap" that can unexpectedly force wrapping on narrow screens.
  return sanitized.replace(/<\/figure>\s+<figure\b/gi, '</figure><figure')
}

function rewriteAssetImageSrc(
  src: string,
  options?: SanitizeRichTextOptions
): null | { full: string; placeholder: string; sd: string; hd: string } {
  if (options?.imageMode !== 'progressive') return null
  const trimmed = src.trim()
  if (!/^\/assets\/[a-zA-Z0-9_-]+$/.test(trimmed)) return null
  const full = trimmed
  return {
    full,
    placeholder: `${full}?w=32&q=20`,
    sd: `${full}?w=854&q=70`,
    hd: `${full}?w=1280&q=80`,
  }
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
