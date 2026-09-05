/**
 * 生成首屏微演示数据（第十二轮第三批 A2，§0 契约）。
 *
 *   npx tsx scripts/generate-home-hero-demo.mts \
 *     [--plan cmth2dorw00048axy6oat70up] [--out content/generated/home-hero-demo.json]
 *
 * 只读生产库（.env.local 的 DATABASE_URL）：取计划最新 daymap 快照的 Day 1，
 * 用 pickHeroDemo 选前 3 个带图可路由点位；图片经生产站的公开
 * /api/anitabi/image-render 代理静态化到 public/images/showcase/（注意：须在
 * generate-home-showcase 之后运行，后者会清空该目录）。形状校验后紧凑 JSON
 * 落盘；不足 3 条即失败退出（微演示固定三步填充）。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvLocal, flagValue } from './homeEnv'
import { ensureProxiedImage } from './homeShowcaseScript'
import { parseHomeHeroDemo, pickHeroDemo } from '@/lib/home/heroDemo'
import { PrismaTripPlanRepo } from '@/lib/tripPlan/repoPrisma'
import { parseDaymapPayload, toPlanView } from '@/lib/tripPlan/view'

/** §0：首屏演示固定用京吹京都巡礼 3 日计划 */
const DEFAULT_PLAN_ID = 'cmth2dorw00048axy6oat70up'
/** 公开 image-render 代理以生产站为基（候选 URL 在 Node 下已是绝对地址，防御相对路径） */
const PROXY_BASE_ORIGIN = 'https://seichigo.com'

function parseArgs(argv: string[]): { planId: string; outPath: string } {
  const planId = flagValue(argv, '--plan') || DEFAULT_PLAN_ID
  const outPath = flagValue(argv, '--out') || 'content/generated/home-hero-demo.json'
  return { planId, outPath }
}

async function main(): Promise<void> {
  loadEnvLocal()
  const { planId, outPath } = parseArgs(process.argv.slice(2))
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (.env.local missing?)')
    process.exit(1)
  }

  const repo = new PrismaTripPlanRepo()
  const plan = await repo.getPlan(planId)
  if (!plan) {
    console.error(`plan ${planId} not found`)
    process.exit(1)
  }
  const messages = await repo.listMessages(planId)

  // 最新 daymap 快照优先；没有交付快照时退回当前 days（与 showcase 同口径）
  let days = toPlanView(plan).days
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const daymap = parseDaymapPayload(messages[i]!.content)
    if (daymap) {
      days = daymap.days
      break
    }
  }

  // 不清空 showcase 目录（那是 generate-home-showcase 的职责，见文件头注释）
  const imageDir = path.join(process.cwd(), 'public', 'images', 'showcase')
  await mkdir(imageDir, { recursive: true })
  let downloaded = 0
  let reused = 0

  const fileExists = async (target: string): Promise<boolean> => {
    try {
      await readFile(target)
      return true
    } catch {
      return false
    }
  }
  const resolveImage = async (url: string): Promise<string> => {
    const fileName = `${createHash('sha1').update(url).digest('hex')}.jpg`
    const filePath = path.join(imageDir, fileName)
    const publicPath = `/images/showcase/${fileName}`
    const outcome = await ensureProxiedImage({
      url,
      imagePath: filePath,
      fileExists,
      writeFile: async (target, bytes) => {
        await writeFile(target, Buffer.from(bytes))
      },
      fetchImage: async (target) => {
        const absolute = /^https?:\/\//i.test(target) ? target : `${PROXY_BASE_ORIGIN}${target}`
        const response = await fetch(absolute)
        if (!response.ok) {
          throw new Error(`proxy fetch failed (${response.status}) for ${absolute}`)
        }
        return new Uint8Array(await response.arrayBuffer())
      },
    })
    if (outcome === 'reused') reused += 1
    else downloaded += 1
    return publicPath
  }

  const day = await pickHeroDemo(days, resolveImage)
  if (!day) {
    console.error(`plan ${planId} has no routable point items with images on day 1`)
    process.exit(1)
  }
  if (day.items.length < 3) {
    console.error(`hero demo needs 3 items but only ${day.items.length} resolved images on day 1`)
    process.exit(1)
  }

  const payload = { planTitle: plan.title, day }
  if (!parseHomeHeroDemo(payload)) {
    console.error('generated payload failed shape validation')
    process.exit(1)
  }

  const serialized = `${JSON.stringify(payload)}\n`
  const outFilePath = path.join(process.cwd(), outPath)
  await mkdir(path.dirname(outFilePath), { recursive: true })
  await writeFile(outFilePath, serialized, 'utf8')

  console.log(`[hero-demo] plan=${planId} (${plan.title}) -> ${outPath}`)
  console.log(
    `[hero-demo] items: ${day.items.map((item) => `${item.time} ${item.title}`).join(' / ')}`
  )
  console.log(`[hero-demo] transit: ${day.transit.label} (images downloaded=${downloaded} reused=${reused})`)
}

await main()
