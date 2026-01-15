import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'SeichiGo — 动漫圣地巡礼攻略'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 72,
          background: 'linear-gradient(135deg, #fff1f2 0%, #ffffff 50%, #fdf2f8 100%)',
        }}
      >
        <div style={{ color: '#db2777', fontSize: 34, fontWeight: 700, letterSpacing: 1 }}>SeichiGo</div>
        <div style={{ marginTop: 18, fontSize: 64, fontWeight: 800, lineHeight: 1.1, color: '#111827' }}>动漫圣地巡礼攻略</div>
        <div style={{ marginTop: 16, fontSize: 28, color: '#4b5563' }}>路线规划 · 点位导航 · 机位建议</div>
        <div style={{ marginTop: 36, fontSize: 18, color: '#6b7280' }}>seichigo.com</div>
      </div>
    ),
    { ...size }
  )
}

