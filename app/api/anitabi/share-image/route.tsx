import { ImageResponse } from 'next/og'
import type { SupportedLocale } from '@/lib/i18n/types'
import { parseMapShareQuery, resolveMapShareSnapshot } from '@/lib/anitabi/share'
import { normalizeLocale } from '@/lib/anitabi/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIZE = { width: 1200, height: 630 }

const COPY: Record<
  SupportedLocale,
  {
    mapLabel: string
    defaultTitle: string
    defaultSubtitle: string
    animeLabel: string
    cityLabel: string
    epLabel: string
    sceneLabel: string
    geoLabel: string
    pointsLabel: string
    footer: string
  }
> = {
  zh: {
    mapLabel: '巡礼地图',
    defaultTitle: '巡礼地图点位分享',
    defaultSubtitle: '打开链接即可进入同一地图状态',
    animeLabel: '作品',
    cityLabel: '城市',
    epLabel: '集数',
    sceneLabel: '场景',
    geoLabel: '坐标',
    pointsLabel: '个点位',
    footer: '打开链接后自动定位到对应点位并显示详情',
  },
  en: {
    mapLabel: 'Pilgrimage Map',
    defaultTitle: 'Pilgrimage Map Share',
    defaultSubtitle: 'Open the link to enter the same map state',
    animeLabel: 'Anime',
    cityLabel: 'City',
    epLabel: 'Episode',
    sceneLabel: 'Scene',
    geoLabel: 'Coord',
    pointsLabel: 'spots',
    footer: 'Open the link to jump to this spot with details',
  },
  ja: {
    mapLabel: '巡礼マップ',
    defaultTitle: '巡礼マップ共有',
    defaultSubtitle: 'リンクを開くと同じ地図状態に移動します',
    animeLabel: '作品',
    cityLabel: '都市',
    epLabel: '話数',
    sceneLabel: 'シーン',
    geoLabel: '座標',
    pointsLabel: 'スポット',
    footer: 'リンクを開くと対象スポットへ移動し、詳細を表示します',
  },
}

function normalizeHexColor(input: string | null | undefined): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null

  const normalized = raw.startsWith('#') ? raw.slice(1) : raw
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null

  if (normalized.length === 3) {
    return `#${normalized.split('').map((ch) => `${ch}${ch}`).join('')}`
  }
  return `#${normalized}`
}

function toRgb(hexColor: string): { r: number; g: number; b: number } {
  const value = normalizeHexColor(hexColor) || '#ec4899'
  const hex = value.slice(1)
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function gradientFromColor(input: string | null | undefined): string {
  const { r, g, b } = toRgb(input || '#ec4899')
  const bright = `rgb(${clampChannel(r + 30)} ${clampChannel(g + 24)} ${clampChannel(b + 24)})`
  const deep = `rgb(${clampChannel(r - 68)} ${clampChannel(g - 62)} ${clampChannel(b - 58)})`
  return `linear-gradient(135deg, ${bright} 0%, ${deep} 100%)`
}

function formatGeo(geo: [number, number] | null): string | null {
  if (!geo) return null
  const [lat, lng] = geo
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  const copy = COPY[locale]
  const query = parseMapShareQuery(url.searchParams)
  const snapshot = await resolveMapShareSnapshot(locale, query)

  const title = snapshot?.pointName || snapshot?.bangumiTitle || copy.defaultTitle
  const subtitle = snapshot?.pointName
    ? `${copy.animeLabel} · ${snapshot.bangumiTitle}`
    : snapshot?.bangumiTitle
      ? `${copy.mapLabel} · ${snapshot.bangumiTitle}`
      : copy.defaultSubtitle

  const chips: string[] = []
  if (snapshot?.bangumiCity) chips.push(`${copy.cityLabel} · ${snapshot.bangumiCity}`)
  if (snapshot?.pointEp) chips.push(`${copy.epLabel} · ${snapshot.pointEp}`)
  if (snapshot?.pointScene) chips.push(`${copy.sceneLabel} · ${snapshot.pointScene}`)
  const geoText = formatGeo(snapshot?.pointGeo || null)
  if (geoText) chips.push(`${copy.geoLabel} · ${geoText}`)

  const pointsCountText = snapshot ? `${snapshot.pointsLength} ${copy.pointsLabel}` : null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          padding: '56px 64px',
          background: gradientFromColor(snapshot?.bangumiColor),
          color: '#ffffff',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            background:
              'linear-gradient(180deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0.32) 46%, rgba(15,23,42,0.58) 100%)',
          }}
        />
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              alignSelf: 'flex-start',
              display: 'flex',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'rgba(15,23,42,0.36)',
              padding: '10px 18px',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            SeichiGo · {copy.mapLabel}
          </div>

          <div style={{ marginTop: 38, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                maxWidth: 980,
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                fontSize: 68,
                lineHeight: 1.06,
                letterSpacing: -0.5,
                fontWeight: 800,
                textShadow: '0 2px 18px rgba(0,0,0,0.45)',
              }}
            >
              {title}
            </div>
            <div
              style={{
                maxWidth: 980,
                marginTop: 14,
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                fontSize: 32,
                lineHeight: 1.2,
                color: 'rgba(255,255,255,0.92)',
              }}
            >
              {subtitle}
            </div>
          </div>

          {chips.length ? (
            <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {chips.slice(0, 4).map((chip) => (
                <div
                  key={chip}
                  style={{
                    display: 'flex',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.28)',
                    background: 'rgba(15,23,42,0.36)',
                    padding: '8px 14px',
                    fontSize: 22,
                    color: 'rgba(255,255,255,0.96)',
                  }}
                >
                  {chip}
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', fontSize: 22, color: 'rgba(255,255,255,0.9)' }}>{copy.footer}</div>
            {pointsCountText ? (
              <div
                style={{
                  display: 'flex',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.26)',
                  background: 'rgba(15,23,42,0.32)',
                  padding: '8px 14px',
                  fontSize: 22,
                  color: 'rgba(255,255,255,0.95)',
                }}
              >
                {pointsCountText}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    }
  )
}
