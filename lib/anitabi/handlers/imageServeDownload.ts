function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null
  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''))
      if (decoded) return decoded
    } catch {
      // noop
    }
  }

  const plainMatch = value.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (plainMatch?.[1]) {
    const name = plainMatch[1].trim()
    if (name) return name
  }
  return null
}

function extensionFromPath(input: string | null | undefined): string | null {
  const text = String(input || '').trim()
  if (!text) return null
  const match = text.match(/\.([a-zA-Z0-9]{2,6})$/)
  if (!match?.[1]) return null
  return `.${match[1].toLowerCase()}`
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg'
  if (normalized.includes('image/png')) return '.png'
  if (normalized.includes('image/webp')) return '.webp'
  if (normalized.includes('image/avif')) return '.avif'
  if (normalized.includes('image/gif')) return '.gif'
  if (normalized.includes('image/svg+xml')) return '.svg'
  return '.jpg'
}

function sanitizeFilenameBase(input: string | null | undefined): string {
  const cleaned = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'anitabi-image'
  return cleaned.slice(0, 80)
}

function trimFileExtension(input: string): string { return input.replace(/\.[a-zA-Z0-9]{2,6}$/, '') }

export function buildDownloadFilename(input: {
  mimeType: string
  pathname: string
  hintName: string | null
  upstreamDisposition: string | null
}): string {
  const fromDisposition = parseContentDispositionFilename(input.upstreamDisposition)
  const fromPath = decodeURIComponent(input.pathname.split('/').filter(Boolean).pop() || '')

  const preferred = fromDisposition || input.hintName || fromPath || 'anitabi-image'
  const base = sanitizeFilenameBase(trimFileExtension(preferred))
  const ext = extensionFromPath(fromDisposition) || extensionFromPath(fromPath) || extensionFromMimeType(input.mimeType)

  return `${base}${ext}`
}

export function buildContentDisposition(filename: string): string {
  const safeUtf8 = filename.replace(/[\r\n]/g, '')
  const fallbackAscii = safeUtf8
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'anitabi-image.jpg'

  return `attachment; filename="${fallbackAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`
}
