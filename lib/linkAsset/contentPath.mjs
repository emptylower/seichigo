/**
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeContentPath(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (!raw.startsWith('/content/')) return null
  if (raw.includes('..')) return null
  return raw
}
