/**
 * 生成首页展示计划快照（第十二轮 A2，§0 契约；审查修复高-3/中-5/中-12/低-3；
 * 第十二轮第三批 A1 点位图静态化）。
 *
 *   npx tsx scripts/generate-home-showcase.mts --plan <planId> \
 *     [--out content/generated/home-showcase.json]
 *
 * 只读生产库（.env.local 的 DATABASE_URL）：取计划最新 daymap 快照的 days
 * （没有则当前 days），把 payload 里的 Google 图片代理 URL 下载成
 * public/images/showcase/<sha1>.jpg 静态文件并改写（maxwidth=320，目录先清空
 * 避免遗留旧尺寸文件），point.image 非空且无 media 的点位条目经公开
 * image-render 代理（生产站）同样静态化并写入 anitabi media 块，再按白名单
 * 瘦身（slimShowcaseDays）；下载失败去掉 media 让组件回落 image-render 候选梯。
 * 输出 { revisionId, savedAt, title, summary, days }，紧凑 JSON 落盘并断言
 * ≤ 100 KB。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvLocal, flagValue } from './homeEnv'
import {
  extractShowcaseSummary,
  parseHomeShowcase,
  rewriteShowcaseDays,
  slimShowcaseDays,
} from '@/lib/home/showcase'
import { ensureProxiedImage, ensureShowcaseImage, resolvePhotoReference } from './homeShowcaseScript'
import { fetchGooglePlacePhoto } from '@/lib/googlePlaces/photoFetch'
import { prisma } from '@/lib/db/prisma'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'
import type { TripPlanMessage } from '@/lib/tripPlan/repo'
import { parseDaymapPayload, toPlanView } from '@/lib/tripPlan/view'
import type { TripPlanDayView } from '@/lib/tripPlan/view'

/** 中-5：展示卡宽度 320px 足够（列表缩略图），比 800px 显著省流量 */
const SHOWCASE_IMAGE_MAX_WIDTH = 320
/** 高-3 预算：home-showcase.json（紧凑 JSON）≤ 100 KB */
const SHOWCASE_JSON_MAX_BYTES = 100 * 1024
/** 中-5 + A1：展示图目录总量 ≤ 2.5 MB（Google 320px + 约 28 张 anitabi h160 缩略图） */
const SHOWCASE_IMAGES_MAX_BYTES = 2.5 * 1024 * 1024
/** A1：公开 image-render 代理以生产站为基（候选 URL 在 Node 下已是绝对地址，防御相对路径） */
const PROXY_BASE_ORIGIN = 'https://seichigo.com'

function parseArgs(argv: string[]): { planId: string; outPath: string } {
  const planId = flagValue(argv, '--plan') || ''
  const outPath = flagValue(argv, '--out') || 'content/generated/home-showcase.json'
  if (!planId) {
    console.error('usage: npx tsx scripts/generate-home-showcase.mts --plan <planId> [--out <path>]')
    process.exit(1)
  }
  return { planId, outPath }
}

async function main(): Promise<void> {
  loadEnvLocal()
  const { planId, outPath } = parseArgs(process.argv.slice(2))
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (.env.local missing?)')
    process.exit(1)
  }
  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!apiKey) {
    console.error('GOOGLE_DIRECTIONS_API_KEY / GOOGLE_MAPS_API_KEY is not set')
    process.exit(1)
  }

  const repo = new PrismaTripPlanRepo()
  const plan = await repo.getPlan(planId)
  if (!plan) {
    console.error(`plan ${planId} not found`)
    process.exit(1)
  }
  const messages: TripPlanMessage[] = await repo.listMessages(planId)

  // 最新 daymap 快照优先；没有交付快照时退回当前 days（快照语义见 lib/tripPlan/view.ts）
  let revisionId = `plan-${plan.id}`
  let savedAt = plan.updatedAt.toISOString()
  let days: TripPlanDayView[] = toPlanView(plan).days
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const daymap = parseDaymapPayload(messages[i]!.content)
    if (daymap) {
      revisionId = daymap.revisionId
      savedAt = daymap.savedAt
      days = daymap.days
      break
    }
  }

  // 中-5：先清空展示图目录再生成，避免遗留旧尺寸（800px）文件
  const imageDir = path.join(process.cwd(), 'public', 'images', 'showcase')
  await rm(imageDir, { recursive: true, force: true })
  await mkdir(imageDir, { recursive: true })
  let downloaded = 0
  let reused = 0
  let dropped = 0

  // 中-12：三层解析 + 下载幂等分支在 homeShowcaseScript.ts（可单测）
  const photoClient = {
    findPointGooglePlaceId: async (pointId: string) => {
      const point = await prisma.anitabiPoint.findUnique({
        where: { id: pointId },
        select: { googlePlaceId: true },
      })
      return point?.googlePlaceId || null
    },
    findExternalPlace: async (placeId: string) => {
      const place = await prisma.externalPlace.findUnique({
        where: { provider_placeId: { provider: 'google', placeId } },
        select: { photos: true, photoReference: true },
      })
      return place
    },
  }

  const fileExists = async (target: string): Promise<boolean> => {
    try {
      await readFile(target)
      return true
    } catch {
      return false
    }
  }
  const writeFileBytes = async (target: string, bytes: Uint8Array): Promise<void> => {
    await writeFile(target, Buffer.from(bytes))
  }
  const fetchProxiedImage = async (target: string): Promise<Uint8Array> => {
    const absolute = /^https?:\/\//i.test(target) ? target : `${PROXY_BASE_ORIGIN}${target}`
    const response = await fetch(absolute)
    if (!response.ok) {
      throw new Error(`proxy fetch failed (${response.status}) for ${absolute}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  const downloader = async (url: string): Promise<string> => {
    const fileName = `${createHash('sha1').update(url).digest('hex')}.jpg`
    const filePath = path.join(imageDir, fileName)
    const publicPath = `/images/showcase/${fileName}`
    try {
      // A1：绝对 URL = 点位图的公开 image-render 代理；相对路径 = Google 图片代理
      const outcome = /^https?:\/\//i.test(url)
        ? await ensureProxiedImage({
          url,
          imagePath: filePath,
          fileExists,
          writeFile: writeFileBytes,
          fetchImage: fetchProxiedImage,
        })
        : await ensureShowcaseImage({
          displayUrl: url,
          imagePath: filePath,
          fileExists,
          writeFile: writeFileBytes,
          resolveReference: (displayUrl) => resolvePhotoReference(displayUrl, photoClient),
          fetchPhoto: async (photoReference) => {
            const fetched = await fetchGooglePlacePhoto({
              photoReference,
              maxWidth: SHOWCASE_IMAGE_MAX_WIDTH,
              apiKey,
            })
            if (!fetched.ok) throw new Error(`fetch failed (${fetched.status}) for ${url}`)
            return fetched.bytes
          },
        })
      if (outcome === 'reused') reused += 1
      else downloaded += 1
      return publicPath
    } catch (reason) {
      dropped += 1
      console.warn(`[showcase] dropped media for ${url.slice(0, 80)}:`, reason)
      throw reason
    }
  }

  // 顺序：先改写下载图片（需要完整 payload 遍历），再白名单瘦身
  const rewrittenDays = await rewriteShowcaseDays(days, downloader, {
    maxWidth: SHOWCASE_IMAGE_MAX_WIDTH,
  })
  const slimmedDays = slimShowcaseDays(rewrittenDays)

  const payload = {
    revisionId,
    savedAt,
    title: plan.title,
    summary: extractShowcaseSummary(messages, plan.title),
    days: slimmedDays,
  }
  if (!parseHomeShowcase(payload)) {
    console.error('generated payload failed shape validation')
    process.exit(1)
  }

  // 低-3：紧凑 JSON（不缩进）；高-3：断言 ≤ 100 KB
  const serialized = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > SHOWCASE_JSON_MAX_BYTES) {
    console.error(
      `showcase payload is ${Buffer.byteLength(serialized, 'utf8')} bytes (budget: ${SHOWCASE_JSON_MAX_BYTES}); ` +
        'tighten the slim whitelist'
    )
    process.exit(1)
  }

  // 中-5：展示图目录总量 ≤ 1.5 MB
  let imageBytes = 0
  for (const entry of await readdir(imageDir)) {
    const info = await stat(path.join(imageDir, entry))
    imageBytes += info.size
  }
  if (imageBytes > SHOWCASE_IMAGES_MAX_BYTES) {
    console.error(`showcase images total ${imageBytes} bytes (budget: ${SHOWCASE_IMAGES_MAX_BYTES})`)
    process.exit(1)
  }

  const outFilePath = path.join(process.cwd(), outPath)
  await mkdir(path.dirname(outFilePath), { recursive: true })
  await writeFile(outFilePath, serialized, 'utf8')

  console.log(`[showcase] plan=${planId} days=${slimmedDays.length} -> ${outPath}`)
  console.log(
    `[showcase] json=${Buffer.byteLength(serialized, 'utf8')}B images=${imageBytes}B ` +
      `(downloaded=${downloaded} reused=${reused} dropped=${dropped})`
  )
}

await main()
