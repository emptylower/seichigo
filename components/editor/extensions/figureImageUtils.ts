export type FigureImageAttrs = {
  src: string
  alt?: string
  naturalWidth?: number | null
  naturalHeight?: number | null
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export function normalizeSrc(value: unknown): string | null {
  const src = String(value || '').trim()
  return src ? src : null
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value == null) return fallback
  if (typeof value === 'string' && value.trim() === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export function normalizeRotate(value: unknown): number {
  const n = clampInt(value, 0, 360, 0)
  const normalized = ((n % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

export function parseBool(value: unknown): boolean {
  if (value === true) return true
  if (value === false) return false
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function parseAlign(value: unknown): 'left' | 'center' | 'right' {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'center') return 'center'
  if (v === 'right') return 'right'
  return 'left'
}

export function formatDeg(value: number): string {
  return `${normalizeRotate(value)}deg`
}

export function computeCropVars(opts: { cropL: number; cropT: number; cropR: number; cropB: number }) {
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

export function computeRotatedSizeVars(opts: { rotate: number; naturalWidth: number | null; naturalHeight: number | null }) {
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
