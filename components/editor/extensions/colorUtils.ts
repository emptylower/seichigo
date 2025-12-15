function clamp255(input: number): number {
  if (!Number.isFinite(input)) return 0
  return Math.max(0, Math.min(255, Math.round(input)))
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function normalizeToHexColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const r = trimmed[1]!
    const g = trimmed[2]!
    const b = trimmed[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }

  const rgb = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/.exec(trimmed)
  if (rgb) {
    const r = clamp255(Number(rgb[1]))
    const g = clamp255(Number(rgb[2]))
    const b = clamp255(Number(rgb[3]))
    return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
  }

  return null
}

export function readStyleAttr(element: Element): string {
  return String(element.getAttribute('style') || '')
}

export function readColorFromStyle(style: string): string | null {
  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const raw = part.slice(idx + 1).trim()
    if (!raw) continue
    if (prop === 'color') return normalizeToHexColor(raw)
  }
  return null
}

export function readBackgroundFromStyle(style: string): string | null {
  for (const chunk of style.split(';')) {
    const part = chunk.trim()
    if (!part) continue
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const raw = part.slice(idx + 1).trim()
    if (!raw) continue
    if (prop === 'background-color') return normalizeToHexColor(raw)
  }
  return null
}

