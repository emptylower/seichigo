import { Node, mergeAttributes } from '@tiptap/core'

function normalizeSrc(value: unknown): string | null {
  const src = String(value || '').trim()
  return src ? src : null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function normalizeRotate(value: unknown): number {
  const n = clampInt(value, 0, 360, 0)
  const normalized = ((n % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

function parseBool(value: unknown): boolean {
  if (value === true) return true
  if (value === false) return false
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function formatDeg(value: number): string {
  return `${normalizeRotate(value)}deg`
}

function computeCropVars(opts: { cropL: number; cropT: number; cropR: number; cropB: number }) {
  const l = clampInt(opts.cropL, 0, 95, 0)
  const t = clampInt(opts.cropT, 0, 95, 0)
  const r = clampInt(opts.cropR, 0, 95, 0)
  const b = clampInt(opts.cropB, 0, 95, 0)

  const fracW = Math.max(1, 100 - l - r)
  const fracH = Math.max(1, 100 - t - b)

  const left = Math.round((-100 * l / fracW) * 100) / 100
  const top = Math.round((-100 * t / fracH) * 100) / 100
  const width = Math.round((10000 / fracW) * 100) / 100
  const height = Math.round((10000 / fracH) * 100) / 100

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  }
}

function computeRotatedSizeVars(opts: { rotate: number; naturalWidth: number | null; naturalHeight: number | null }) {
  if (opts.rotate !== 90 && opts.rotate !== 270) return { w: '100%', h: '100%' }
  const nw = opts.naturalWidth ?? null
  const nh = opts.naturalHeight ?? null
  if (!nw || !nh) return { w: '100%', h: '100%' }
  const ar = nw / nh
  if (!Number.isFinite(ar) || ar <= 0) return { w: '100%', h: '100%' }
  const w = `${Math.round(ar * 100)}%`
  const h = `${Math.round((1 / ar) * 100)}%`
  return { w, h }
}

export const FigureImageServer = Node.create({
  name: 'figureImage',
  group: 'block',
  content: 'inline*',
  marks: 'bold italic underline strike link',
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      widthPct: { default: 100 },
      cropL: { default: 0 },
      cropT: { default: 0 },
      cropR: { default: 0 },
      cropB: { default: 0 },
      rotate: { default: 0 },
      flipX: { default: false },
      flipY: { default: false },
      naturalWidth: { default: null },
      naturalHeight: { default: null },
      caption: { default: false },
    }
  },

  renderHTML({ node, HTMLAttributes }) {
    const src = normalizeSrc((node.attrs as any)?.src)
    const alt = String((node.attrs as any)?.alt || '')
    if (!src) return ['p', 0]

    const widthPct = clampInt((node.attrs as any)?.widthPct, 10, 100, 100)
    const cropL = clampInt((node.attrs as any)?.cropL, 0, 95, 0)
    const cropT = clampInt((node.attrs as any)?.cropT, 0, 95, 0)
    const cropR = clampInt((node.attrs as any)?.cropR, 0, 95, 0)
    const cropB = clampInt((node.attrs as any)?.cropB, 0, 95, 0)
    const cropEnabled = cropL > 0 || cropT > 0 || cropR > 0 || cropB > 0
    const rotate = normalizeRotate((node.attrs as any)?.rotate)
    const flipX = parseBool((node.attrs as any)?.flipX)
    const flipY = parseBool((node.attrs as any)?.flipY)
    const naturalWidth = (() => {
      const v = clampInt((node.attrs as any)?.naturalWidth, 0, 200000, 0)
      return v > 0 ? v : null
    })()
    const naturalHeight = (() => {
      const v = clampInt((node.attrs as any)?.naturalHeight, 0, 200000, 0)
      return v > 0 ? v : null
    })()

    const hasTransforms = cropEnabled || rotate !== 0 || flipX || flipY
    const mode = hasTransforms ? 'transform' : 'plain'

    const figureStyleParts: string[] = [`width:${widthPct}%`]

    const frameStyleParts: string[] = []
    if (mode === 'transform' && naturalWidth && naturalHeight) {
      const fracW = Math.max(1, 100 - cropL - cropR)
      const fracH = Math.max(1, 100 - cropT - cropB)
      const wEff = naturalWidth * fracW
      const hEff = naturalHeight * fracH
      const ratio = rotate === 90 || rotate === 270 ? `${hEff} / ${wEff}` : `${wEff} / ${hEff}`
      frameStyleParts.push(`aspect-ratio:${ratio}`)
    }

    const { w, h } = computeRotatedSizeVars({ rotate, naturalWidth, naturalHeight })
    const imgStyleParts = [
      `--seichi-rot:${formatDeg(rotate)}`,
      `--seichi-flip-x:${flipX ? -1 : 1}`,
      `--seichi-flip-y:${flipY ? -1 : 1}`,
      `--seichi-w:${w}`,
      `--seichi-h:${h}`,
    ]
    if (cropEnabled) {
      const cropVars = computeCropVars({ cropL, cropT, cropR, cropB })
      imgStyleParts.push(`--seichi-crop-left:${cropVars.left}`)
      imgStyleParts.push(`--seichi-crop-top:${cropVars.top}`)
      imgStyleParts.push(`--seichi-crop-width:${cropVars.width}`)
      imgStyleParts.push(`--seichi-crop-height:${cropVars.height}`)
    }

    const captionText = String(node.textContent || '').trim()
    const hasCaption = captionText.length > 0

    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-figure-image': 'true',
        'data-width-pct': String(widthPct),
        style: figureStyleParts.join(';'),
      }),
      [
        'div',
        {
          'data-figure-image-container': 'true',
          'data-width-pct': String(widthPct),
        },
        [
          'div',
          {
            'data-figure-image-frame': 'true',
            'data-mode': mode,
            style: frameStyleParts.join(';'),
          },
          [
            'img',
            {
              src,
              alt,
              draggable: 'true',
              'data-rotate': String(rotate),
              'data-flip-x': flipX ? '1' : '0',
              'data-flip-y': flipY ? '1' : '0',
              'data-crop-l': cropL ? String(cropL) : undefined,
              'data-crop-t': cropT ? String(cropT) : undefined,
              'data-crop-r': cropR ? String(cropR) : undefined,
              'data-crop-b': cropB ? String(cropB) : undefined,
              'data-natural-w': naturalWidth ? String(naturalWidth) : undefined,
              'data-natural-h': naturalHeight ? String(naturalHeight) : undefined,
              style: imgStyleParts.join(';'),
            },
          ],
        ],
        ...(hasCaption ? [['figcaption', 0]] : []),
      ],
    ]
  },
})

export const SeichiRouteServer = Node.create({
  name: 'seichiRoute',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      data: { default: null },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const id = String((HTMLAttributes as any)?.id || '').trim()
    return ['seichi-route', mergeAttributes(id ? { 'data-id': id } : {})]
  },
})

export const SeichiCalloutServer = Node.create({
  name: 'seichiCallout',
  group: 'block',
  content: 'block+',

  parseHTML() {
    return [{ tag: 'seichi-callout' }]
  },

  renderHTML() {
    return ['seichi-callout', 0]
  },
})
