export type MapImageRequestLane =
  | 'interaction-critical'
  | 'viewport-thumbnail'
  | 'viewport-visible'
  | 'warmup-first-view'
  | 'warmup'

export type MapImageRequestLease = {
  lane: MapImageRequestLane
  release: () => void
}

type MapImageRequestSchedulerConfig = {
  maxActive: number
  // These are total-active thresholds, not per-lane concurrency caps.
  // Lower lanes stop admitting new work earlier to preserve headroom for higher lanes.
  laneStartThresholds: Record<MapImageRequestLane, number>
}

type QueueEntry = {
  lane: MapImageRequestLane
  resolve: (lease: MapImageRequestLease) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  cleanup: () => void
}

const DEFAULT_CONFIG: MapImageRequestSchedulerConfig = {
  maxActive: 8,
  laneStartThresholds: {
    'interaction-critical': 8,
    'viewport-thumbnail': 7,
    'viewport-visible': 5,
    'warmup-first-view': 6,
    warmup: 3,
  },
}

function createAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function clampStartThreshold(maxActive: number, value: number): number {
  return Math.max(1, Math.min(maxActive, Math.floor(value)))
}

export class MapImageRequestScheduler {
  private readonly maxActive: number
  private readonly laneStartThresholds: Record<MapImageRequestLane, number>
  private readonly queue: QueueEntry[] = []
  private activeTotal = 0
  private readonly activeByLane: Record<MapImageRequestLane, number> = {
    'interaction-critical': 0,
    'viewport-thumbnail': 0,
    'viewport-visible': 0,
    'warmup-first-view': 0,
    warmup: 0,
  }

  constructor(config: Partial<MapImageRequestSchedulerConfig> = {}) {
    const maxActive = Math.max(1, Math.floor(config.maxActive ?? DEFAULT_CONFIG.maxActive))
    const laneStartThresholds = config.laneStartThresholds ?? DEFAULT_CONFIG.laneStartThresholds
    this.maxActive = maxActive
    this.laneStartThresholds = {
      'interaction-critical': clampStartThreshold(
        maxActive,
        laneStartThresholds['interaction-critical'] ?? DEFAULT_CONFIG.laneStartThresholds['interaction-critical'],
      ),
      'viewport-thumbnail': clampStartThreshold(
        maxActive,
        laneStartThresholds['viewport-thumbnail'] ?? DEFAULT_CONFIG.laneStartThresholds['viewport-thumbnail'],
      ),
      'viewport-visible': clampStartThreshold(
        maxActive,
        laneStartThresholds['viewport-visible'] ?? DEFAULT_CONFIG.laneStartThresholds['viewport-visible'],
      ),
      'warmup-first-view': clampStartThreshold(
        maxActive,
        laneStartThresholds['warmup-first-view'] ?? DEFAULT_CONFIG.laneStartThresholds['warmup-first-view'],
      ),
      warmup: clampStartThreshold(
        maxActive,
        laneStartThresholds.warmup ?? DEFAULT_CONFIG.laneStartThresholds.warmup,
      ),
    }
  }

  acquire(input: {
    lane: MapImageRequestLane
    signal?: AbortSignal
  }): Promise<MapImageRequestLease> {
    if (input.signal?.aborted) {
      return Promise.reject(createAbortError())
    }

    return new Promise<MapImageRequestLease>((resolve, reject) => {
      const entry: QueueEntry = {
        lane: input.lane,
        resolve,
        reject,
        signal: input.signal,
        cleanup: () => {},
      }

      const onAbort = () => {
        const index = this.queue.indexOf(entry)
        if (index >= 0) {
          this.queue.splice(index, 1)
        }
        entry.cleanup()
        reject(createAbortError())
        this.drain()
      }

      entry.cleanup = () => {
        if (input.signal) {
          input.signal.removeEventListener('abort', onAbort)
        }
      }

      if (input.signal) {
        input.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.queue.push(entry)
      this.drain()
    })
  }

  snapshot() {
    return {
      activeTotal: this.activeTotal,
      activeByLane: { ...this.activeByLane },
      queuedByLane: {
        'interaction-critical': this.queue.filter((entry) => entry.lane === 'interaction-critical').length,
        'viewport-thumbnail': this.queue.filter((entry) => entry.lane === 'viewport-thumbnail').length,
        'viewport-visible': this.queue.filter((entry) => entry.lane === 'viewport-visible').length,
        'warmup-first-view': this.queue.filter((entry) => entry.lane === 'warmup-first-view').length,
        warmup: this.queue.filter((entry) => entry.lane === 'warmup').length,
      },
      laneStartThresholds: { ...this.laneStartThresholds },
    }
  }

  private drain(): void {
    for (;;) {
      const nextIndex = this.findNextEligibleIndex()
      if (nextIndex < 0) return
      const [entry] = this.queue.splice(nextIndex, 1)
      entry.cleanup()
      if (entry.signal?.aborted) {
        entry.reject(createAbortError())
        continue
      }
      entry.resolve(this.createLease(entry.lane))
    }
  }

  private findNextEligibleIndex(): number {
    if (this.activeTotal >= this.maxActive) {
      return -1
    }

    const laneOrder: MapImageRequestLane[] = [
      'interaction-critical',
      'viewport-thumbnail',
      'viewport-visible',
      'warmup-first-view',
      'warmup',
    ]
    for (const lane of laneOrder) {
      if (this.activeTotal >= this.laneStartThresholds[lane]) {
        continue
      }
      const index = this.queue.findIndex((entry) => entry.lane === lane)
      if (index >= 0) {
        return index
      }
    }

    return -1
  }

  private createLease(lane: MapImageRequestLane): MapImageRequestLease {
    this.activeTotal += 1
    this.activeByLane[lane] += 1

    let released = false
    return {
      lane,
      release: () => {
        if (released) return
        released = true
        this.activeTotal = Math.max(0, this.activeTotal - 1)
        this.activeByLane[lane] = Math.max(0, this.activeByLane[lane] - 1)
        this.drain()
      },
    }
  }
}

let globalMapImageRequestScheduler = new MapImageRequestScheduler()

export function acquireMapImageRequestSlot(input: {
  lane: MapImageRequestLane
  signal?: AbortSignal
}): Promise<MapImageRequestLease> {
  return globalMapImageRequestScheduler.acquire(input)
}

export async function acquireTimedMapImageRequestSlot(input: {
  lane: MapImageRequestLane
  signal?: AbortSignal
}): Promise<{ lease: MapImageRequestLease; queueWaitMs: number }> {
  const waitStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const lease = await acquireMapImageRequestSlot(input)
  return {
    lease,
    queueWaitMs: Math.max(
      0,
      Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - waitStartedAt),
    ),
  }
}

export function resetMapImageRequestSchedulerForTest(config?: Partial<MapImageRequestSchedulerConfig>): void {
  globalMapImageRequestScheduler = new MapImageRequestScheduler(config)
}

export function readMapImageRequestSchedulerSnapshotForTest() {
  return globalMapImageRequestScheduler.snapshot()
}
