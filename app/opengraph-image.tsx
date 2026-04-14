export const size = { width: 1200, height: 630 }
export const contentType = 'image/svg+xml'
export const alt = 'SeichiGo — 动漫圣地巡礼攻略'

export default function Image() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#fff1f2"/>
      <stop offset="55%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#fdf2f8"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="170" fill="#db2777" font-size="42" font-weight="700" font-family="system-ui, -apple-system, Segoe UI, sans-serif">SeichiGo</text>
  <text x="80" y="300" fill="#111827" font-size="78" font-weight="800" font-family="system-ui, -apple-system, Segoe UI, sans-serif">动漫圣地巡礼攻略</text>
  <text x="80" y="380" fill="#4b5563" font-size="36" font-weight="500" font-family="system-ui, -apple-system, Segoe UI, sans-serif">路线规划 · 点位导航 · 机位建议</text>
  <text x="80" y="500" fill="#6b7280" font-size="24" font-weight="500" font-family="system-ui, -apple-system, Segoe UI, sans-serif">seichigo.com</text>
</svg>`.trim()

  return new Response(svg, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
