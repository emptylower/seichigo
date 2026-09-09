import { getMapDisplayImageCandidatesAsync } from '@/lib/anitabi/imageProxy'
import { loadMapImageWithCandidates } from '@/components/map/utils/loadMapImageWithCandidates'
import {
  createCoverSpriteSource,
  type CoverSpriteSource,
  type CoverSpriteTile,
} from '@/components/map/utils/coverSpriteSource'

export interface MapLike {
  addImage(id: string, data: unknown, options?: { pixelRatio?: number }): void
  removeImage(id: string): void
  loadImage(url: string): Promise<{ data: unknown }>
  hasImage?(id: string): boolean
}

export type CoverAvatarCandidate = {
  bangumiId: number
  coverUrl: string | null
}

export interface CoverAvatarLoaderOptions {
  map: MapLike
  maxLoaded?: number
  firstViewTrackedLimit?: number
  directRequestTimeoutMs?: number
  proxyRequestTimeoutMs?: number
  /**
   * 2026-09-10 任务 3：服务端预生成封面 sprite。命中的番剧直接本地切片
   * addImage（零网络请求）；未命中/不可用的番剧回落到原候选梯逐张加载。
   * 默认开启（sprite 未生成时 404 自动回落，删除 R2 atlas 即为停用开关）；
   * 显式传 null 可完全关闭（测试/回滚）。
   */
  spriteSource?: CoverSpriteSource | null
  onTrackedRequestStart?: (input: {
    slotKey: string
    requestedCandidateUrl: string
    candidateIndex: number
    candidateCount: number
    reuseChain: boolean
    queueWaitMs?: number
  }) => {
    requestUrl: string
    requestId: string
  } | null
  onTrackedRequestTerminal?: (input: {
    handle: { requestUrl: string; requestId: string } | null
    terminalState: 'succeeded' | 'failed' | 'aborted'
    finalUrl: string
    chainTerminal: boolean
    outcome?: string
  }) => void
}

const DEFAULT_MAX_LOADED = 160
const MAX_CONCURRENT_LOADS = 6
const FAILED_RETRY_COOLDOWN_MS = 8_000
const AVATAR_SIZE = 72
const AVATAR_BORDER = 3
const EXTRA_ALLOWED_COVER_HOSTS = ['anitabi.cn', 'bgm.tv']

function buildCoverViewportSignature(candidates: CoverAvatarCandidate[]): string {
  return candidates
    .map((candidate) => `${candidate.bangumiId}:${String(candidate.coverUrl || '')}`)
    .join('|')
}

export class CoverAvatarLoader {
  private readonly map: MapLike
  private readonly maxLoaded: number
  private readonly firstViewTrackedLimit: number
  private readonly directRequestTimeoutMs?: number
  private readonly proxyRequestTimeoutMs?: number
  private readonly spriteSource?: CoverSpriteSource | null
  private readonly onTrackedRequestStart?: CoverAvatarLoaderOptions['onTrackedRequestStart']
  private readonly onTrackedRequestTerminal?: CoverAvatarLoaderOptions['onTrackedRequestTerminal']
  private readonly lru = new Map<string, number>()
  private readonly failedAt = new Map<string, number>()
  private readonly loading = new Set<string>()
  private accessCounter = 0
  private activeUpdateAbortController: AbortController | null = null
  private activeViewportSignature: string | null = null
  private activeViewportConsumers = 0
  private updateQueue: Promise<void> = Promise.resolve()

  constructor(options: CoverAvatarLoaderOptions) {
    this.map = options.map
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED
    this.firstViewTrackedLimit = Math.max(0, options.firstViewTrackedLimit ?? 0)
    this.directRequestTimeoutMs = options.directRequestTimeoutMs
    this.proxyRequestTimeoutMs = options.proxyRequestTimeoutMs
    this.spriteSource = options.spriteSource === undefined
      ? createCoverSpriteSource()
      : options.spriteSource
    this.onTrackedRequestStart = options.onTrackedRequestStart
    this.onTrackedRequestTerminal = options.onTrackedRequestTerminal
  }

  async updateViewport(candidates: CoverAvatarCandidate[]): Promise<Set<string>> {
    let snapshot = new Set<string>()
    const viewportSignature = buildCoverViewportSignature(candidates)
    const sameViewport = this.activeViewportSignature === viewportSignature
      && this.activeUpdateAbortController != null
    if (sameViewport) {
      await this.updateQueue
      return new Set(this.lru.keys())
    }

    this.activeUpdateAbortController?.abort()
    this.activeUpdateAbortController = new AbortController()
    this.activeViewportSignature = viewportSignature
    this.activeViewportConsumers = 0

    const abortController = this.activeUpdateAbortController!
    this.activeViewportConsumers += 1
    const run = async () => {
      if (abortController.signal.aborted) {
        snapshot = new Set(this.lru.keys())
        return
      }
      const seen = new Set<number>()
      const toLoad: { imageId: string; urls: string[]; tracked: boolean }[] = []
      const now = Date.now()
      const candidateLimit = Math.max(1, this.maxLoaded)
      let visibleIndex = 0

      // sprite 快路径：命中的番剧全部本地切片，不进候选梯（网络请求 118 → 1–2 的关键）。
      // 拉不到（未生成/404/解析失败）时 loadTiles 返回空 Map，全员回落旧路径。
      let spriteTiles = new Map<number, CoverSpriteTile>()
      if (this.spriteSource) {
        try {
          spriteTiles = await this.spriteSource.loadTiles(
            candidates
              .slice(0, candidateLimit)
              .map((candidate) => candidate.bangumiId)
              .filter((bangumiId) => Number.isFinite(bangumiId)),
            abortController.signal,
          )
        } catch {
          spriteTiles = new Map()
        }
        if (abortController.signal.aborted) {
          snapshot = new Set(this.lru.keys())
          return
        }
      }

      for (const candidate of candidates) {
        if (seen.size >= candidateLimit) break
        if (!Number.isFinite(candidate.bangumiId) || seen.has(candidate.bangumiId)) continue
        seen.add(candidate.bangumiId)

        const rawCover = this.normalizeCoverUrl(String(candidate.coverUrl || '').trim())
        if (!rawCover) continue
        if (!this.isAllowedCoverHost(rawCover)) continue

        const imageId = `cover-${candidate.bangumiId}`
        const spriteTile = spriteTiles.get(candidate.bangumiId)
        if (spriteTile) {
          const spriteStillOnMap = typeof this.map.hasImage === 'function'
            ? this.map.hasImage(imageId)
            : true
          if (this.lru.has(imageId) && spriteStillOnMap) {
            this.lru.set(imageId, ++this.accessCounter)
            continue
          }
          if (this.lru.has(imageId) && !spriteStillOnMap) {
            this.lru.delete(imageId)
          }
          this.map.addImage(imageId, spriteTile, { pixelRatio: 1 })
          this.lru.set(imageId, ++this.accessCounter)
          this.failedAt.delete(imageId)
          continue
        }
        // R2 直出候选（mirror key 异步计算，内部 memo 缓存，重复视口零开销）
        const candidateUrls = await getMapDisplayImageCandidatesAsync(rawCover, { kind: 'cover' })
        if (candidateUrls.length === 0) continue
        const tracked = visibleIndex < this.firstViewTrackedLimit
        visibleIndex += 1
        const failedAt = this.failedAt.get(imageId)
        if (failedAt != null && now - failedAt < FAILED_RETRY_COOLDOWN_MS) {
          continue
        }
        if (failedAt != null) this.failedAt.delete(imageId)
        const imageStillOnMap = typeof this.map.hasImage === 'function'
          ? this.map.hasImage(imageId)
          : true
        if (this.lru.has(imageId) && imageStillOnMap) {
          this.lru.set(imageId, ++this.accessCounter)
          continue
        }
        if (this.lru.has(imageId) && !imageStillOnMap) {
          this.lru.delete(imageId)
        }
        if (this.loading.has(imageId)) continue

        this.loading.add(imageId)
        toLoad.push({ imageId, urls: candidateUrls, tracked })
      }

      await this.loadBatch(toLoad, abortController.signal)
      this.evict()
      snapshot = new Set(this.lru.keys())
    }

    const queued = this.updateQueue.then(run, run)
    this.updateQueue = queued.then(() => undefined, () => undefined)
    await queued.finally(() => {
      if (this.activeUpdateAbortController === abortController) {
        this.activeViewportConsumers = Math.max(0, this.activeViewportConsumers - 1)
        if (this.activeViewportConsumers === 0) {
          this.activeUpdateAbortController = null
          this.activeViewportSignature = null
        }
      }
    })
    return snapshot
  }

  private async loadBatch(items: Array<{ imageId: string; urls: string[]; tracked: boolean }>, signal: AbortSignal): Promise<void> {
    // 候选收集阶段已有 await（R2 mirror key 异步解析），中止可能落在 loading.add
    // 之后、worker 循环之前——此时逐项 try/finally 不会执行，必须在这里清掉
    // loading 标记，否则该 imageId 会被永久跳过
    if (signal.aborted) {
      for (const item of items) {
        this.loading.delete(item.imageId)
      }
      return
    }
    let index = 0

    const worker = async (): Promise<void> => {
      while (index < items.length && !signal.aborted) {
        const current = items[index++]
        try {
          const result = await loadMapImageWithCandidates({
            map: this.map,
            slotKey: current.imageId,
            urls: current.urls,
            tracked: current.tracked,
            requestLane: 'viewport-visible',
            hostPolicyScope: 'cover',
            directRequestTimeoutMs: this.directRequestTimeoutMs,
            proxyRequestTimeoutMs: this.proxyRequestTimeoutMs,
            onTrackedRequestStart: this.onTrackedRequestStart,
            onTrackedRequestTerminal: this.onTrackedRequestTerminal,
            requestSignal: signal,
          })
          const existsOnMap = typeof this.map.hasImage === 'function' ? this.map.hasImage(current.imageId) : false
          if (!existsOnMap) {
            const avatarData = this.toAvatarImageData(result.data)
            if (avatarData) {
              this.map.addImage(current.imageId, avatarData, { pixelRatio: 1 })
            } else {
              this.map.addImage(current.imageId, result.data)
            }
          }
          this.lru.set(current.imageId, ++this.accessCounter)
          this.failedAt.delete(current.imageId)
        } catch (error) {
          if ((error as Error)?.name === 'AbortError' || signal.aborted) {
            return
          }
          this.failedAt.set(current.imageId, Date.now())
          // Skip failed images; dots and labels remain as fallback.
        } finally {
          this.loading.delete(current.imageId)
        }
      }
    }

    const workers = Math.min(MAX_CONCURRENT_LOADS, items.length)
    const jobs: Promise<void>[] = []
    for (let i = 0; i < workers; i += 1) {
      jobs.push(worker())
    }
    await Promise.all(jobs)
  }

  private normalizeCoverUrl(raw: string): string {
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (raw.startsWith('/')) return `https://www.anitabi.cn${raw}`
    return raw
  }

  private isAllowedCoverHost(raw: string): boolean {
    try {
      const url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com')
      const host = url.hostname.trim().toLowerCase()
      if (!host) return false
      if (typeof window !== 'undefined') {
        const currentHost = window.location.hostname.trim().toLowerCase()
        if (host === currentHost || host.endsWith(`.${currentHost}`)) return true
      }
      return EXTRA_ALLOWED_COVER_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))
    } catch {
      return false
    }
  }

  private toAvatarImageData(input: unknown): ImageData | null {
    if (typeof document === 'undefined') return null
    const source = this.toCanvasImageSource(input)
    if (!source) return null

    const sourceWidth = Number((source as { width?: unknown }).width || 0)
    const sourceHeight = Number((source as { height?: unknown }).height || 0)
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
      return null
    }

    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const minSide = Math.min(sourceWidth, sourceHeight)
    const sx = (sourceWidth - minSide) / 2
    const sy = (sourceHeight - minSide) / 2
    const innerSize = AVATAR_SIZE - AVATAR_BORDER * 2
    const radius = innerSize / 2
    const center = AVATAR_SIZE / 2

    ctx.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(center, center, center - 1, 0, Math.PI * 2)
    ctx.fill()

    ctx.save()
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(
      source,
      sx,
      sy,
      minSide,
      minSide,
      AVATAR_BORDER,
      AVATAR_BORDER,
      innerSize,
      innerSize,
    )
    ctx.restore()

    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.beginPath()
    ctx.arc(center, center, radius, 0, Math.PI * 2)
    ctx.stroke()

    return ctx.getImageData(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  }

  private toCanvasImageSource(input: unknown): CanvasImageSource | null {
    if (typeof ImageBitmap !== 'undefined' && input instanceof ImageBitmap) {
      return input
    }
    if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement) {
      return input
    }
    if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
      return input
    }
    if (typeof OffscreenCanvas !== 'undefined' && input instanceof OffscreenCanvas) {
      return input
    }
    if (typeof ImageData !== 'undefined' && input instanceof ImageData && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = input.width
      canvas.height = input.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.putImageData(input, 0, 0)
      return canvas
    }
    return null
  }

  private evict(): void {
    if (this.lru.size <= this.maxLoaded) return
    const sorted = [...this.lru.entries()].sort((a, b) => a[1] - b[1])
    const removeCount = this.lru.size - this.maxLoaded
    for (const [imageId] of sorted.slice(0, removeCount)) {
      this.map.removeImage(imageId)
      this.lru.delete(imageId)
    }
  }
}
