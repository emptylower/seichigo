const PROD_SITE_URL = 'https://seichigo.com'
const DEV_SITE_URL = 'http://localhost:3000'

export function getSiteUrl(): string {
  const raw = String(process.env.SITE_URL || '').trim()
  if (raw) return raw
  if (process.env.NODE_ENV === 'production') return PROD_SITE_URL
  return DEV_SITE_URL
}

export function getSiteOrigin(): string {
  return getSiteUrl().replace(/\/$/, '')
}

