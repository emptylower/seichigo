export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/svg+xml'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const title = decodeURIComponent(id)
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <text x="80" y="150" fill="#f472b6" font-size="34" font-weight="700" font-family="system-ui, -apple-system, Segoe UI, sans-serif">SeichiGo</text>
  <text x="80" y="290" fill="#ffffff" font-size="70" font-weight="800" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${title}</text>
  <text x="80" y="370" fill="#cbd5e1" font-size="32" font-weight="500" font-family="system-ui, -apple-system, Segoe UI, sans-serif">圣地巡礼目的地</text>
</svg>`.trim()

  return new Response(svg, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
