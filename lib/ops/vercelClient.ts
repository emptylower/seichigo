const VERCEL_API_BASE = 'https://api.vercel.com'
const DEFAULT_TIMEOUT_MS = 20_000

export type OpsVercelConfig = {
  token: string
  projectId: string
  teamId: string | null
  timeoutMs: number
}

export type VercelDeployment = {
  id: string
  createdAt: Date | null
  name: string | null
  url: string | null
  raw: Record<string, unknown>
}

export class OpsConfigError extends Error {
  readonly code = 'OPS_CONFIG_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'OpsConfigError'
  }
}

export class OpsExternalError extends Error {
  readonly code = 'OPS_EXTERNAL_ERROR'
  readonly status: number
  readonly body: string

  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'OpsExternalError'
    this.status = status
    this.body = body
  }
}

export function resolveOpsVercelConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; value: OpsVercelConfig } | { ok: false; error: string } {
  const token = String(env.OPS_VERCEL_API_TOKEN || '').trim()
  const projectId = String(env.OPS_VERCEL_PROJECT_ID || env.VERCEL_PROJECT_ID || '').trim()
  const teamIdRaw = String(env.OPS_VERCEL_TEAM_ID || env.VERCEL_TEAM_ID || '').trim()
  const timeoutRaw = Number(env.OPS_VERCEL_TIMEOUT_MS || '')

  if (!token) {
    return { ok: false, error: 'Missing OPS_VERCEL_API_TOKEN' }
  }

  if (!projectId) {
    return { ok: false, error: 'Missing OPS_VERCEL_PROJECT_ID (or VERCEL_PROJECT_ID)' }
  }

  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(2_000, Math.min(60_000, Math.floor(timeoutRaw)))
    : DEFAULT_TIMEOUT_MS

  return {
    ok: true,
    value: {
      token,
      projectId,
      teamId: teamIdRaw || null,
      timeoutMs,
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return []
}

function toDate(value: unknown): Date | null {
  if (value == null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 2_000_000_000 ? value : value * 1000
    const d = new Date(ms)
    return Number.isFinite(d.getTime()) ? d : null
  }

  if (typeof value === 'string') {
    const parsedNumber = Number(value)
    if (Number.isFinite(parsedNumber)) {
      const ms = parsedNumber > 2_000_000_000 ? parsedNumber : parsedNumber * 1000
      const d = new Date(ms)
      if (Number.isFinite(d.getTime())) return d
    }

    const d = new Date(value)
    if (Number.isFinite(d.getTime())) return d
  }

  return null
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

export class VercelClient {
  private readonly token: string
  private readonly projectId: string
  private readonly teamId: string | null
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(config: OpsVercelConfig, fetchImpl: typeof fetch = fetch) {
    this.token = config.token
    this.projectId = config.projectId
    this.teamId = config.teamId
    this.timeoutMs = config.timeoutMs
    this.fetchImpl = fetchImpl
  }

  private buildUrl(path: string, searchParams?: URLSearchParams): string {
    const url = new URL(path, VERCEL_API_BASE)

    if (searchParams) {
      for (const [key, value] of searchParams.entries()) {
        if (value != null && value !== '') {
          url.searchParams.set(key, value)
        }
      }
    }

    if (this.teamId) {
      url.searchParams.set('teamId', this.teamId)
    }

    return url.toString()
  }

  private async requestJson<T>(path: string, searchParams?: URLSearchParams): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await this.fetchImpl(this.buildUrl(path, searchParams), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new OpsExternalError(`Vercel API request failed (${res.status})`, res.status, body)
      }

      return (await res.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  async listDeployments(args?: {
    limit?: number
    windowStart?: Date
    windowEnd?: Date
  }): Promise<VercelDeployment[]> {
    const limit = Number.isFinite(Number(args?.limit))
      ? Math.max(1, Math.min(100, Math.floor(Number(args?.limit))))
      : 8

    const params = new URLSearchParams()
    params.set('projectId', this.projectId)
    params.set('limit', String(limit))
    params.set('state', 'READY')

    if (args?.windowStart) {
      params.set('from', String(args.windowStart.getTime()))
    }

    if (args?.windowEnd) {
      params.set('to', String(args.windowEnd.getTime()))
    }

    const payload = await this.requestJson<unknown>('/v6/deployments', params)
    const root = asRecord(payload)
    const rows = asArray(root.deployments)

    return rows
      .map((item) => {
        const rec = asRecord(item)
        const id = toStringOrNull(rec.id)
        if (!id) return null

        return {
          id,
          createdAt: toDate(rec.createdAt),
          name: toStringOrNull(rec.name),
          url: toStringOrNull(rec.url),
          raw: rec,
        } satisfies VercelDeployment
      })
      .filter((item): item is VercelDeployment => Boolean(item))
  }

  async listDeploymentEvents(
    deploymentId: string,
    args?: { limit?: number; windowStart?: Date; windowEnd?: Date }
  ): Promise<Array<Record<string, unknown>>> {
    const id = String(deploymentId || '').trim()
    if (!id) return []

    const limit = Number.isFinite(Number(args?.limit))
      ? Math.max(1, Math.min(20_000, Math.floor(Number(args?.limit))))
      : 2_500

    const params = new URLSearchParams()
    params.set('limit', String(limit))
    params.set('direction', 'backward')

    if (args?.windowStart) {
      params.set('since', String(args.windowStart.getTime()))
    }

    if (args?.windowEnd) {
      params.set('until', String(args.windowEnd.getTime()))
    }

    const fallbackPaths = [`/v2/deployments/${encodeURIComponent(id)}/events`, `/v3/deployments/${encodeURIComponent(id)}/events`]

    let lastError: unknown = null
    for (const path of fallbackPaths) {
      try {
        const payload = await this.requestJson<unknown>(path, params)
        const root = asRecord(payload)
        const rows = Array.isArray(payload)
          ? payload
          : Array.isArray(root.events)
            ? root.events
            : Array.isArray(root.logs)
              ? root.logs
              : []

        return rows.map((item) => asRecord(item))
      } catch (error) {
        lastError = error
        if (error instanceof OpsExternalError && [400, 404, 405].includes(error.status)) {
          continue
        }
        throw error
      }
    }

    if (lastError) throw lastError
    return []
  }
}

export function createOpsVercelClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): VercelClient {
  const config = resolveOpsVercelConfigFromEnv(env)
  if (!config.ok) {
    throw new OpsConfigError(config.error)
  }
  return new VercelClient(config.value, fetchImpl)
}
