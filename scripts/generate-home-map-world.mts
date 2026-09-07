/**
 * 生成首页第二屏静态世界地图（2026-09-07 计划 A 部分，§1 数据契约）。
 *
 *   npm run generate:home-map-world
 *
 * 底图：World location map (equirectangular 180).svg，作者 TUBS，
 * 来源 https://upload.wikimedia.org/wikipedia/commons/b/b0/World_location_map_%28equirectangular_180%29.svg
 * 许可 CC BY-SA 3.0（https://creativecommons.org/licenses/by-sa/3.0/deed.zh）。
 * 等距圆柱投影，viewBox 0 0 2520.631 1260.315 恰好对应经度 -180..180、
 * 纬度 90..-90（已验证）。下载缓存到 .omc/cache/world-location-map.svg
 * （gitignore 目录，二次运行直接用缓存）。请求头带 User-Agent
 * （seichigo-dev/1.0 (contact@seichigo.com)，Wikimedia UA 政策）。
 *
 * 不使用 MapLibre / Playwright / 瓦片：只做下载、重上色、栅格化、裁成
 * 太平洋居中视角、烘焙点位（home-map-clusters.json 的 cells）、落盘两张
 * WebP 与 content/generated/home-map-world.json。2x 超过 350 KB 降 q 到
 * 74 再试，仍超则非零退出、不落盘。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { parseHomeMapClusters } from '@/lib/home/mapClusters'
import { parseHomeMapWorld } from '@/lib/home/mapWorld'
import {
  IMAGE_2X_MAX_BYTES,
  IMG_1X_HEIGHT,
  IMG_1X_WIDTH,
  IMG_2X_HEIGHT,
  IMG_2X_WIDTH,
  WORLD_BOUNDS,
  assertWorldArtifact,
  buildPointsOverlaySvg,
  buildWorldLabels,
  recolorWorldSvg,
} from './homeMapWorldScript'

const BASEMAP_URL =
  'https://upload.wikimedia.org/wikipedia/commons/b/b0/World_location_map_%28equirectangular_180%29.svg'
const USER_AGENT = 'seichigo-dev/1.0 (contact@seichigo.com)'
const CACHE_PATH = path.join(process.cwd(), '.omc/cache/world-location-map.svg')
const OUT_2X = path.join(process.cwd(), 'public/images/home/map-world@2x.webp')
const OUT_1X = path.join(process.cwd(), 'public/images/home/map-world.webp')
const OUT_JSON = path.join(process.cwd(), 'content/generated/home-map-world.json')
const CLUSTERS_JSON = path.join(process.cwd(), 'content/generated/home-map-clusters.json')
const ATTRIBUTION = '底图：TUBS / Wikimedia Commons, CC BY-SA 3.0'

/** 栅格化基准画布：360°×180° → 7px/°，裁切像素全部由它线性换算（整数舍入） */
const BASE_W = 2520
const BASE_H = 1260
const PX_PER_DEG = BASE_W / 360

const SEG_A_LEFT = Math.round((WORLD_BOUNDS.lngStart + 180) * PX_PER_DEG) // -22° → x 1106
const SEG_A_WIDTH = Math.round((180 - WORLD_BOUNDS.lngStart) * PX_PER_DEG) // -22..180 → 1414px
const SEG_B_WIDTH = Math.round(
  (WORLD_BOUNDS.lngStart + WORLD_BOUNDS.lngSpan - 360 + 180) * PX_PER_DEG
) // -180..-37 → 1001px
const CROP_TOP = Math.round((90 - WORLD_BOUNDS.latTop) * PX_PER_DEG) // 74°N → y 112
const CROP_HEIGHT = Math.round((WORLD_BOUNDS.latTop - WORLD_BOUNDS.latBottom) * PX_PER_DEG) // 126° → 882px

async function loadBaseSvg(): Promise<string> {
  try {
    const cached = await readFile(CACHE_PATH, 'utf8')
    if (cached.includes('2520.631')) return cached
  } catch {
    // 无缓存，走下载
  }

  const response = await fetch(BASEMAP_URL, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) {
    throw new Error(`basemap download failed: HTTP ${response.status}`)
  }
  const svg = await response.text()
  if (!svg.includes('2520.631') || !svg.includes('1260.315')) {
    throw new Error('basemap shape unexpected (viewBox not 2520.631x1260.315)')
  }
  await mkdir(path.dirname(CACHE_PATH), { recursive: true })
  await writeFile(CACHE_PATH, svg, 'utf8')
  return svg
}

async function buildWorldPng(svg: string, cells: Array<{ lng: number; lat: number; count: number }>): Promise<Buffer> {
  const recolored = recolorWorldSvg(svg)

  const base = await sharp(Buffer.from(recolored))
    .resize(BASE_W, BASE_H)
    .flatten({ background: '#DCEBFA' })
    .png()
    .toBuffer()

  // 太平洋居中：-22..180 一段 + 跨 180° 回绕的 -180..-37 一段，横向拼到 2416 宽画布
  const segA = await sharp(base)
    .extract({ left: SEG_A_LEFT, top: 0, width: SEG_A_WIDTH, height: BASE_H })
    .png()
    .toBuffer()
  const segB = await sharp(base)
    .extract({ left: 0, top: 0, width: SEG_B_WIDTH, height: BASE_H })
    .png()
    .toBuffer()
  const stitched = await sharp({
    create: { width: IMG_2X_WIDTH, height: BASE_H, channels: 4, background: '#DCEBFA' },
  })
    .composite([
      { input: segA, left: 0, top: 0 },
      { input: segB, left: SEG_A_WIDTH, top: 0 },
    ])
    .png()
    .toBuffer()

  const cropped = await sharp(stitched)
    .extract({ left: 0, top: CROP_TOP, width: IMG_2X_WIDTH, height: CROP_HEIGHT })
    .png()
    .toBuffer()

  // §A-3：叠层基准半径就是 2x 图像素值，无需再放大（1x 由整图缩半得到）
  const overlaySvg = buildPointsOverlaySvg(cells, WORLD_BOUNDS, IMG_2X_WIDTH, IMG_2X_HEIGHT)
  const overlay = await sharp(Buffer.from(overlaySvg)).png().toBuffer()
  return sharp(cropped).composite([{ input: overlay, left: 0, top: 0 }]).png().toBuffer()
}

async function main(): Promise<void> {
  const clustersRaw = JSON.parse(await readFile(CLUSTERS_JSON, 'utf8'))
  const clusters = parseHomeMapClusters(clustersRaw)
  if (!clusters) {
    console.error('home-map-clusters.json failed shape validation')
    process.exit(1)
  }

  const svg = await loadBaseSvg()
  console.log(`[home-map-world] basemap ${svg.length}B (cache ${CACHE_PATH})`)

  const worldPng = await buildWorldPng(svg, clusters.cells)

  let quality = 82
  let out2x = await sharp(worldPng).webp({ quality }).toBuffer()
  if (out2x.byteLength > IMAGE_2X_MAX_BYTES) {
    quality = 74
    out2x = await sharp(worldPng).webp({ quality }).toBuffer()
  }
  const out1x = await sharp(worldPng).resize(IMG_1X_WIDTH, IMG_1X_HEIGHT).webp({ quality: 82 }).toBuffer()

  const meta2x = await sharp(out2x).metadata()
  const meta1x = await sharp(out1x).metadata()
  const labels = buildWorldLabels(clusters)
  assertWorldArtifact({
    labels,
    bounds: WORLD_BOUNDS,
    width2x: meta2x.width ?? 0,
    height2x: meta2x.height ?? 0,
    width1x: meta1x.width ?? 0,
    height1x: meta1x.height ?? 0,
    bytes2x: out2x.byteLength,
  })

  const artifact = {
    generatedAt: new Date().toISOString(),
    totalPoints: clusters.totalPoints,
    image: {
      src: '/images/home/map-world.webp',
      src2x: '/images/home/map-world@2x.webp',
      width: IMG_1X_WIDTH,
      height: IMG_1X_HEIGHT,
      bounds: WORLD_BOUNDS,
      attribution: ATTRIBUTION,
    },
    labels,
  }
  if (!parseHomeMapWorld(artifact)) {
    console.error('generated payload failed shape validation; nothing written')
    process.exit(1)
  }

  await mkdir(path.dirname(OUT_2X), { recursive: true })
  await mkdir(path.dirname(OUT_JSON), { recursive: true })
  await writeFile(OUT_2X, out2x)
  await writeFile(OUT_1X, out1x)
  await writeFile(OUT_JSON, `${JSON.stringify(artifact)}\n`, 'utf8')

  console.log(
    `[home-map-world] ${path.relative(process.cwd(), OUT_2X)} ${out2x.byteLength}B q${quality} (budget ${IMAGE_2X_MAX_BYTES}B)`
  )
  console.log(`[home-map-world] ${path.relative(process.cwd(), OUT_1X)} ${out1x.byteLength}B`)
  console.log(
    `[home-map-world] ${path.relative(process.cwd(), OUT_JSON)} labels=${labels.length} totalPoints=${clusters.totalPoints}`
  )
}

try {
  await main()
} catch (error) {
  console.error('[home-map-world] failed:', error)
  process.exit(1)
}
