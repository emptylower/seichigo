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
 * 不落盘），map 块（src/尺寸/markers/attribution）写回 JSON。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { loadEnvLocal, flagValue } from './homeEnv'
import { parseHomeHeroDemo } from '@/lib/home/heroDemo'

const MAP_WIDTH = 320
const MAP_HEIGHT = 240
const FIT_BOUNDS_PADDING = 36
const WEBP_QUALITY = 80
const MAP_IMAGE_MAX_BYTES = 60 * 1024
const MAPTILER_STYLE_ID = 'dataviz'
const MAP_ATTRIBUTION = '© MapTiler © OpenStreetMap contributors'
const IDLE_TIMEOUT_MS = 90_000
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
      ({ points: pts, styleUrl: url, padding }) => {
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
          map.fitBounds(bounds, { padding, duration: 0 })
          fitted = true
        })
      },
      { points, styleUrl, padding: FIT_BOUNDS_PADDING }
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

    const projected = await page.evaluate((pts: Array<{ id: string; lat: number; lng: number }>) => {
      const map = (window as unknown as { __heroMap: { project: (lngLat: [number, number]) => { x: number; y: number } } }).__heroMap
      return pts.map((point) => {
        const { x, y } = map.project([point.lng, point.lat])
        return { itemId: point.id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }
      })
    }, points)

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
      },
    }
    if (!parseHomeHeroDemo(nextPayload)) {
      console.error('map-augmented payload failed shape validation; JSON left untouched')
      process.exit(1)
    }
    await writeFile(path.join(process.cwd(), jsonPath), `${JSON.stringify(nextPayload)}\n`, 'utf8')

    console.log(`[hero-map] ${outPath} ${webp.byteLength}B (budget ${MAP_IMAGE_MAX_BYTES}B)`)
    console.log(`[hero-map] markers: ${JSON.stringify(projected)}`)
    console.log(`[hero-map] map block written back to ${jsonPath}`)
  } finally {
    await browser.close()
  }
}

await main()
