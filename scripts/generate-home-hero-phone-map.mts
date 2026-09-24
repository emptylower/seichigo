/**
 * 截首屏手机演示的静态地图（第十四轮 §0 契约 A3）。
 *
 *   npx tsx scripts/generate-home-hero-phone-map.mts \
 *     [--json content/generated/home-hero-demo.json] \
 *     [--out public/images/home/hero-phone-map.webp]
 *
 * 读 home-hero-demo.json 里 day.items 的坐标（须在 generate-home-hero-demo.mts
 * 之后运行）：Playwright 起 headless chromium（swiftshader 软渲染），页面是
 * 内联了 node_modules/maplibre-gl 产物的最小 HTML，加载 MapTiler dataviz
 * style（NEXT_PUBLIC_MAPTILER_KEY，.env.local），视口 320×240、deviceScale
 * Factor 2，fitBounds 三点 padding 36，等 idle 后截屏；map.project 得到三点
 * 的 CSS 像素坐标。截图经 sharp 转 WebP q80（≤ 60 KB，超预算非零退出，
 * 不落盘），map 块（src/尺寸/markers/attribution/routePath）写回 JSON。
 *
 * 真实步行路线：截图前按 items 顺序请求 Mapbox Directions（walking，
 * MAPBOX_DIRECTIONS_TOKEN，.env.local），fitBounds 同时框进三点与路线全部顶点；
 * 顶点用同一个 map.project 投影到 CSS 像素，Douglas-Peucker（0.75px）抽稀、
 * 保留两位小数后拼成 SVG path `d` 写入 map.routePath。首页只读这份烘焙结果，
 * 运行时不请求任何路线接口。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { loadEnvLocal, flagValue } from './homeEnv'
import { parseHomeHeroDemo } from '@/lib/home/heroDemo'
import { fetchMapboxRoute, readMapboxToken } from '@/lib/routeBook/mapboxRoute'

const MAP_WIDTH = 320
const MAP_HEIGHT = 240
const FIT_BOUNDS_PADDING = 36
const WEBP_QUALITY = 80
const MAP_IMAGE_MAX_BYTES = 60 * 1024
const MAPTILER_STYLE_ID = 'dataviz'
const MAP_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors'
const IDLE_TIMEOUT_MS = 90_000
/** 路线抽稀容差（CSS 像素）：肉眼看不出差别，顶点压到几十个 */
const ROUTE_SIMPLIFY_TOLERANCE_PX = 0.75
/** headless 无 GPU 环境渲染 WebGL 地图必需（maplibre 官方 e2e 同款参数） */
const CHROMIUM_LAUNCH_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
]

function parseArgs(argv: string[]): { jsonPath: string; outPath: string } {
  const jsonPath = flagValue(argv, '--json') || 'content/generated/home-hero-demo.json'
  const outPath = flagValue(argv, '--out') || 'public/images/home/hero-phone-map.webp'
  return { jsonPath, outPath }
}

type PixelPoint = { x: number; y: number }

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 点到线段 ab 的距离（像素） */
function segmentDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Douglas-Peucker（栈式，避免长折线递归过深），首尾点恒保留 */
function simplifyPath(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length <= 2) return points.slice()
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let maxDistance = 0
    let maxIndex = -1
    for (let i = start + 1; i < end; i += 1) {
      const distance = segmentDistance(points[i]!, points[start]!, points[end]!)
      if (distance > maxDistance) {
        maxDistance = distance
        maxIndex = i
      }
    }
    if (maxIndex >= 0 && maxDistance > tolerance) {
      keep[maxIndex] = true
      stack.push([start, maxIndex], [maxIndex, end])
    }
  }
  return points.filter((_, index) => keep[index])
}

/** 抽稀后的像素折线 → `M x y L x y …`，相邻重复点（两位小数后）去掉 */
function buildRoutePath(points: PixelPoint[]): { d: string; count: number } {
  const rounded = points.map((point) => ({ x: round2(point.x), y: round2(point.y) }))
  const deduped = rounded.filter((point, index) => {
    const prev = rounded[index - 1]
    return !prev || prev.x !== point.x || prev.y !== point.y
  })
  const d = deduped.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  return { d, count: deduped.length }
}

/** 内联 maplibre-gl js/css 的最小宿主页（无外链资源，离线于本项目静态资产） */
function buildMapHtml(maplibreJs: string, maplibreCss: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${maplibreCss}</style>
<script>${maplibreJs}</script>
<style>
  html, body { margin: 0; padding: 0; width: ${MAP_WIDTH}px; height: ${MAP_HEIGHT}px; overflow: hidden; }
  #map { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="map"></div>
</body>
</html>`
}

async function main(): Promise<void> {
  loadEnvLocal()
  const { jsonPath, outPath } = parseArgs(process.argv.slice(2))
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY
  if (!maptilerKey) {
    console.error('NEXT_PUBLIC_MAPTILER_KEY is not set (.env.local missing?)')
    process.exit(1)
  }

  const rawJson = await readFile(path.join(process.cwd(), jsonPath), 'utf8')
  const demo = parseHomeHeroDemo(JSON.parse(rawJson))
  if (!demo) {
    console.error(`${jsonPath} failed shape validation`)
    process.exit(1)
  }
  const points = demo.day.items.map((item) => ({ id: item.id, lat: item.lat, lng: item.lng }))
  if (points.length < 2) {
    console.error('hero demo needs at least 2 items with coords to frame a map')
    process.exit(1)
  }

  const mapboxToken = readMapboxToken()
  if (!mapboxToken) {
    console.error('Mapbox token is not set: need MAPBOX_DIRECTIONS_TOKEN (or NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN) in env/.env.local to fetch the walking route')
    process.exit(1)
  }
  const route = await fetchMapboxRoute(points, 'walking', { token: mapboxToken })
  if (!route.ok) {
    console.error(`Mapbox walking route failed (reason: ${route.reason}); JSON and image left untouched`)
    process.exit(1)
  }
  const routeCoords = route.geometry.coordinates
  console.log(
    `[hero-map] walking route: ${routeCoords.length} vertices, ${Math.round(route.distance)} m, ${Math.round(route.duration / 60)} min`
  )

  const maplibreJs = await readFile(path.join(process.cwd(), 'node_modules/maplibre-gl/dist/maplibre-gl.js'), 'utf8')
  const maplibreCss = await readFile(path.join(process.cwd(), 'node_modules/maplibre-gl/dist/maplibre-gl.css'), 'utf8')
  const styleUrl = `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${encodeURIComponent(maptilerKey)}`

  const browser = await chromium.launch({ headless: true, args: CHROMIUM_LAUNCH_ARGS })
  try {
    const page = await browser.newPage({
      viewport: { width: MAP_WIDTH, height: MAP_HEIGHT },
      deviceScaleFactor: 2,
    })
    page.on('pageerror', (error) => console.error('[pageerror]', error.message))
    await page.setContent(buildMapHtml(maplibreJs, maplibreCss), { waitUntil: 'domcontentloaded' })
    // tsx/esbuild 会给序列化进 page.evaluate 的函数注入 __name(...) 辅助调用，
    // 页面里没有这个标识符；垫一个恒等函数让它安静通过
    await page.evaluate('window.__name = (fn) => fn')

    await page.evaluate(
      ({ points: pts, routeCoords: line, styleUrl: url, padding }) => {
        const state = { phase: 'loading' as string, error: '' }
        ;(window as unknown as Record<string, unknown>).__heroState = state
        const fail = (event: { error?: { message?: string } }) => {
          state.phase = 'error'
          state.error = String(event?.error?.message || 'map error')
        }
        const map = new window.maplibregl.Map({
          container: 'map',
          style: url,
          center: [pts[0]!.lng, pts[0]!.lat],
          zoom: 13,
          interactive: false,
          attributionControl: false,
        })
        ;(window as unknown as Record<string, unknown>).__heroMap = map
        map.on('error', fail)
        let fitted = false
        map.on('idle', () => {
          if (fitted) state.phase = 'idle'
        })
        map.on('load', () => {
          const bounds = new window.maplibregl.LngLatBounds()
          for (const point of pts) bounds.extend([point.lng, point.lat])
          // 路线可能绕出三点的外接框，一并框进去，避免叠加层画出图外被裁
          for (const coord of line) bounds.extend(coord)
          map.fitBounds(bounds, { padding, duration: 0 })
          fitted = true
        })
      },
      { points, routeCoords, styleUrl, padding: FIT_BOUNDS_PADDING }
    )

    await page.waitForFunction(
      () => {
        const state = (window as unknown as { __heroState?: { phase: string; error: string } }).__heroState
        if (!state) return false
        if (state.phase === 'error') throw new Error(state.error || 'map failed to render')
        return state.phase === 'idle'
      },
      { timeout: IDLE_TIMEOUT_MS }
    )

    // 图钉与路线顶点在同一个 map 实例、同一次 evaluate 里投影，保证同一像素空间
    const { projected, routePixels } = await page.evaluate(
      ({ pts, line }: { pts: Array<{ id: string; lat: number; lng: number }>; line: [number, number][] }) => {
        const map = (window as unknown as { __heroMap: { project: (lngLat: [number, number]) => { x: number; y: number } } }).__heroMap
        return {
          projected: pts.map((point) => {
            const { x, y } = map.project([point.lng, point.lat])
            return { itemId: point.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
          }),
          routePixels: line.map((coord) => {
            const { x, y } = map.project(coord)
            return { x, y }
          }),
        }
      },
      { pts: points, line: routeCoords }
    )

    const simplified = simplifyPath(routePixels, ROUTE_SIMPLIFY_TOLERANCE_PX)
    const routePath = buildRoutePath(simplified)
    const xs = simplified.map((point) => point.x)
    const ys = simplified.map((point) => point.y)
    const bbox = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    if (bbox.minX < 0 || bbox.minY < 0 || bbox.maxX > MAP_WIDTH || bbox.maxY > MAP_HEIGHT) {
      console.error(`walking route pokes outside the ${MAP_WIDTH}x${MAP_HEIGHT} image: ${JSON.stringify(bbox)}`)
      process.exit(1)
    }

    const screenshot = await page.screenshot({
      clip: { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT },
    })

    const webp = await sharp(screenshot).webp({ quality: WEBP_QUALITY }).toBuffer()
    if (webp.byteLength > MAP_IMAGE_MAX_BYTES) {
      console.error(`hero phone map is ${webp.byteLength} bytes (budget: ${MAP_IMAGE_MAX_BYTES}) at q${WEBP_QUALITY}`)
      process.exit(1)
    }

    const outFile = path.join(process.cwd(), outPath)
    await mkdir(path.dirname(outFile), { recursive: true })
    await writeFile(outFile, webp)

    const nextPayload = {
      planTitle: demo.planTitle,
      day: demo.day,
      map: {
        src: `/${outPath.replace(/^public\//, '')}`,
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        markers: projected,
        attribution: MAP_ATTRIBUTION,
        routePath: routePath.d,
      },
    }
    if (!parseHomeHeroDemo(nextPayload)) {
      console.error('map-augmented payload failed shape validation; JSON left untouched')
      process.exit(1)
    }
    await writeFile(path.join(process.cwd(), jsonPath), `${JSON.stringify(nextPayload)}\n`, 'utf8')

    console.log(`[hero-map] ${outPath} ${webp.byteLength}B (budget ${MAP_IMAGE_MAX_BYTES}B)`)
    console.log(`[hero-map] markers: ${JSON.stringify(projected)}`)
    console.log(
      `[hero-map] routePath: ${routePixels.length} -> ${routePath.count} points, bbox ${JSON.stringify({
        minX: round2(bbox.minX),
        minY: round2(bbox.minY),
        maxX: round2(bbox.maxX),
        maxY: round2(bbox.maxY),
      })}`
    )
    console.log(`[hero-map] map block written back to ${jsonPath}`)
  } finally {
    await browser.close()
  }
}

await main()
