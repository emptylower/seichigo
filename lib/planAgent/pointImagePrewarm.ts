import { enumeratePointImageVariants, type MirrorVariant } from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey, resolveAnitabiDeliveryUrl } from '@/lib/anitabi/imageNormalize'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'
import { getMirroredImage, putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'

/**
 * 第六轮 C：保存即预热。save_plan_days / 补齐续跑共用的 enrichPipeline 在补齐
 * 完成后，把计划里点位图的两个镜像变体（h160 + w640q80，复用
 * imageMirrorVariants 的口径）后台预热进 R2：getMirroredImage 已命中的不
 * fetch；未命中的 fetch 投递域（img-tc.anitabi.cn）→ putMirroredImage
 * （mirrorSource='lazy'）→ upsert MapImageMirrorState 为 mirrored。
 * 状态行 sourceType/sourceId/variant 与 cron 侧同键（point-image + 点位 id），
 * 不再另起一套 canonical pathname 键。任何失败只 warn，绝不影响保存主流程。
 * 无 bucket（本地开发）直接跳过。
 */

const DEFAULT_USER_AGENT = 'SeichiGoMirror/1.0 (+https://seichigo.com)'
const DEFAULT_MAX_IMAGES = 40
const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 8_000

export type PointImagePrewarmUpsertArgs = {
  where: { sourceType_sourceId_variant: { sourceType: string; sourceId: string; variant: string } }
  create: {
    sourceType: string
    sourceId: string
    variant: string
    canonicalUrl: string
    r2Key: string
    status: 'mirrored'
    attempts: number
    lastAttemptAt: Date
    mirroredAt: Date
    contentBytes: number
    lastError: null
  }
  update: {
    canonicalUrl: string
    r2Key: string
    status: 'mirrored'
    mirroredAt: Date
    contentBytes: number
    lastError: null
  }
}

export type PointImagePrewarmPrisma = {
  mapImageMirrorState: {
    upsert: (args: PointImagePrewarmUpsertArgs) => Promise<unknown>
  }
}

export type PrewarmPointRef = {
  pointId: string
  imageUrl: string
}

export type PrewarmPointImagesInput = {
  points: PrewarmPointRef[]
  bucket: R2MirrorBucket
  prisma: PointImagePrewarmPrisma
  fetchImpl?: typeof fetch
  maxImages?: number
  concurrency?: number
  timeoutMs?: number
}

export type PrewarmPointImagesResult = {
  considered: number
  hit: number
  mirrored: number
  failed: number
}

type PrewarmTask = MirrorVariant & { sourceId: string; mimeType: string }

function inferImageMimeType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.avif')) return 'image/avif'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  return 'image/jpeg'
}

/** 非点位图 / 非 anitabi host 的 URL 枚举不出变体，自然被过滤掉 */
function buildTasks(points: PrewarmPointRef[], maxImages: number): PrewarmTask[] {
  const tasks: PrewarmTask[] = []
  const seenVariantUrls = new Set<string>()
  const seenPointIds = new Set<string>()
  const uniqueSources = points
    .filter((point) => {
      const pointId = point.pointId.trim()
      const imageUrl = point.imageUrl.trim()
      if (!pointId || !imageUrl || seenPointIds.has(pointId)) return false
      seenPointIds.add(pointId)
      return true
    })
    .slice(0, maxImages)

  for (const source of uniqueSources) {
    for (const variant of enumeratePointImageVariants(source.imageUrl)) {
      if (seenVariantUrls.has(variant.url)) continue
      seenVariantUrls.add(variant.url)
      tasks.push({
        ...variant,
        // 状态行 sourceId 用点位 id，与 cron 侧（delta/bootstrap）同键，
        // 避免每个点位两套状态行
        sourceId: source.pointId,
        mimeType: inferImageMimeType(variant.url),
      })
    }
  }

  return tasks
}

async function fetchVariantBytes(
  canonicalVariantUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    // canonical 始终是 image.anitabi.cn；真正请求投递域（img-tc），与镜像任务同口径
    const deliveryUrl = resolveAnitabiDeliveryUrl(new URL(canonicalVariantUrl)).toString()
    const response = await fetchImpl(deliveryUrl, {
      headers: { 'user-agent': DEFAULT_USER_AGENT },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`upstream ${response.status}`)
    }

    const mimeType = String(response.headers.get('content-type') || '').trim()
    if (!mimeType.toLowerCase().startsWith('image/')) {
      throw new Error('non_image_response')
    }

    return { bytes: await response.arrayBuffer(), mimeType }
  } finally {
    clearTimeout(timer)
  }
}

async function prewarmOne(task: PrewarmTask, input: PrewarmPointImagesInput): Promise<'hit' | 'mirrored' | 'failed'> {
  try {
    const existing = await getMirroredImage(input.bucket, task.url, task.mimeType).catch(() => null)
    if (existing) return 'hit'

    const { bytes, mimeType } = await fetchVariantBytes(
      task.url,
      input.fetchImpl ?? fetch,
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    const put = await putMirroredImage(input.bucket, task.url, bytes, mimeType, 'lazy')
    const now = new Date()
    await input.prisma.mapImageMirrorState.upsert({
      where: {
        sourceType_sourceId_variant: {
          sourceType: 'point-image',
          sourceId: task.sourceId,
          variant: task.label,
        },
      },
      create: {
        sourceType: 'point-image',
        sourceId: task.sourceId,
        variant: task.label,
        canonicalUrl: task.url,
        r2Key: put.key,
        status: 'mirrored',
        attempts: 1,
        lastAttemptAt: now,
        mirroredAt: now,
        contentBytes: put.existingSize ?? put.bytesWritten,
        lastError: null,
      },
      update: {
        canonicalUrl: task.url,
        r2Key: put.key,
        status: 'mirrored',
        mirroredAt: now,
        contentBytes: put.existingSize ?? put.bytesWritten,
        lastError: null,
      },
    })
    return 'mirrored'
  } catch (error) {
    console.warn('[planAgent] point image prewarm failed', task.url, error)
    return 'failed'
  }
}

export async function prewarmPointImages(input: PrewarmPointImagesInput): Promise<PrewarmPointImagesResult> {
  const tasks = buildTasks(input.points, input.maxImages ?? DEFAULT_MAX_IMAGES)
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY)
  const result: PrewarmPointImagesResult = { considered: tasks.length, hit: 0, mirrored: 0, failed: 0 }

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const task = tasks[cursor]!
      cursor += 1
      result[await prewarmOne(task, input)] += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker))

  return result
}

/**
 * 保存即预热的派发入口（enrichPipeline 在 enrichAndNormalizeDays 后调用）：
 * 调用方从条目的 pointId 与 coordsByPointId.get(pointId).image 组装
 * { pointId, imageUrl } 对（状态行 sourceId 与 cron 侧同键）；无 bucket
 * （本地）直接跳过；否则按第五轮 runInBackground 的模式派发——优先当前请求
 * ctx.waitUntil（以 ctx 为 this 调用，回归第五轮 R1），无绑定时浮动 promise，
 * 异常只 warn。
 */
export function dispatchPointImagePrewarm(
  points: PrewarmPointRef[],
  overrides?: { prisma?: PointImagePrewarmPrisma; fetchImpl?: typeof fetch },
): void {
  const bindings = getCfBindings()
  const bucket = bindings?.env?.MAP_IMAGE_CACHE
  if (!bucket) return

  const uniquePoints = [
    ...new Map(
      points
        .map((point) => ({ pointId: point.pointId.trim(), imageUrl: point.imageUrl.trim() }))
        .filter((point) => point.pointId && point.imageUrl)
        .map((point) => [point.pointId, point] as const),
    ).values(),
  ]
  if (!uniquePoints.length) return

  const task = async (): Promise<unknown> => {
    const prisma = overrides?.prisma ?? (await import('@/lib/db/prisma')).prisma
    return prewarmPointImages({ points: uniquePoints, bucket, prisma, fetchImpl: overrides?.fetchImpl })
  }
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => {
      console.warn('[planAgent] point image prewarm dispatch failed', error)
    })
  const cfCtx = bindings?.ctx
  if (cfCtx?.waitUntil) cfCtx.waitUntil(promise)
  else void promise
}
