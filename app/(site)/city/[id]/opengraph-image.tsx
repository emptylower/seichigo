import { ImageResponse } from 'next/og'
import { getCityBySlugOrRedirect } from '@/lib/city/db'
import { getSiteOrigin } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

function toAbsoluteUrl(input: string | null | undefined, base: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    return new URL(raw, base).toString()
  } catch {
    return null
  }
}

function hash32(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const decodedSlug = decodeURIComponent(id)
  const { city } = await getCityBySlugOrRedirect(decodedSlug).catch(() => ({ city: null }))

  const name = city?.name_zh || decodedSlug
  const nameJa = city?.name_ja
  const coverUrl = city?.cover ? toAbsoluteUrl(city.cover, getSiteOrigin()) : null

  const seed = hash32(decodedSlug)
  const hue1 = (seed % 60) + 180
  const hue2 = (hue1 + 30) % 360
  const bgGradient = `linear-gradient(135deg, hsl(${hue1} 45% 25%), hsl(${hue2} 50% 18%))`

  return new ImageResponse(
    coverUrl ? (
      <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', backgroundColor: '#0b0b0f' }}>
        <img src={coverUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.58) 45%, rgba(0,0,0,0.25) 78%, rgba(0,0,0,0) 100%), linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.72) 100%)' }} />
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 72 }}>
          <div style={{ alignSelf: 'flex-start', fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.92)', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 16px', borderRadius: 999, marginBottom: 20, display: 'flex' }}>
            <span style={{ color: '#f472b6' }}>SeichiGo</span>
          </div>
          <div style={{ maxWidth: 980, fontSize: 76, fontWeight: 800, lineHeight: 1.06, color: 'rgba(255,255,255,0.98)', textShadow: '0 2px 14px rgba(0,0,0,0.60)' }}>
            {name}
          </div>
          {nameJa ? (
            <div style={{ fontSize: 32, marginTop: 18, color: 'rgba(255,255,255,0.88)', display: 'flex' }}>
              {nameJa} · 圣地巡礼
            </div>
          ) : (
            <div style={{ fontSize: 32, marginTop: 18, color: 'rgba(255,255,255,0.88)', display: 'flex' }}>
              圣地巡礼目的地
            </div>
          )}
        </div>
      </div>
    ) : (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: bgGradient, padding: 72, justifyContent: 'flex-end' }}>
        <div style={{ alignSelf: 'flex-start', fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,0.92)', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.14)', padding: '10px 16px', borderRadius: 999, marginBottom: 20, display: 'flex' }}>
          <span style={{ color: '#f472b6' }}>SeichiGo</span>
        </div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.06, color: 'rgba(255,255,255,0.98)' }}>{name}</div>
        {nameJa ? (
          <div style={{ fontSize: 32, marginTop: 18, color: 'rgba(255,255,255,0.75)', display: 'flex' }}>{nameJa}</div>
        ) : (
          <div style={{ fontSize: 32, marginTop: 18, color: 'rgba(255,255,255,0.75)', display: 'flex' }}>圣地巡礼目的地</div>
        )}
      </div>
    ),
    { ...size }
  )
}
