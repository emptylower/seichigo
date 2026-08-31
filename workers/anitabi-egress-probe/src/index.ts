/**
 * 一次性 Worker 出口探测（WS0）。
 *
 * 目的：判断 seichigo 的**生产 Worker 出口**能否触达上游两套 CDN。
 * 结果决定 WS1 走「服务端代理 + R2」还是降级为「浏览器直连」。
 *
 * 测量位置必须与生产一致（这是结果能当发布门槛的前提）：
 *   - 生产的图片抓取发生在主 Worker 的 fetch handler（lib/anitabi/handlers/imageServe.ts），
 *     作品/点位抓取发生在 lib/anitabi/source/client.ts。两者都在普通 Worker 请求上下文里。
 *   - 因此**探测也在本 worker 的 fetch handler 内执行**，而不是在 Durable Object 里：
 *     DO 被钉在单一 colo、且是不同的执行上下文，其出口不能代表生产。
 *   - 每个目标使用与真实调用方相同的 UA / Accept（见 UPSTREAM_TARGETS），
 *     让测量结果对得上生产行为。
 *   - Worker 在接收请求的 colo 执行，生产流量遍布全球 colo，**单点结果不能代表全网**。
 *     所以结果**按 colo 分键存储**：从不同 colo 各触发一次会累积覆盖面，
 *     同一 colo 重复触发则直接返回既有结果、不再打上游。
 *   - 存储键还含**判据版本**（CRITERIA_VERSION）。判据逻辑一改就提版本号，
 *     旧版本结果不再算命中、会自然重探 —— 否则 write-if-absent 会让过时结论
 *     永久留存并被当成有效门槛数据。GET / 把旧版本结果单列为 stale 并注明不可用于发布判定。
 *
 * 一致性：DO 只做存储，且**只写一个 key、只在探测成功后写一次**（write-if-absent）。
 *   没有独立的「已领取」标记，所以 isolate 被杀 / CPU 超限 / 请求中断都不会留下半状态，
 *   下次请求可正常重试 —— 不存在需要手动清库的永久卡死。
 *   诚实边界：同一 colo 的并发突发请求可能各探测一次（每轮最多多一次）；
 *   要完全避免就得引入「领取」标记，那会重新带来卡死风险，权衡后选择不卡死。
 *
 * 端点：
 *   GET  /       返回已存的全部 per-colo 结果；无结果则提示如何触发。绝不自己探测。
 *   POST /probe  在当前 colo 探测一次（需 x-probe-secret）。该 colo 已有结果则直接返回。
 */

/** 每个目标连同其在生产中的真实调用方特征，保证测量可类比。 */
const UPSTREAM_TARGETS = [
  {
    url: 'https://api.anitabi.cn/bangumi/115908/lite',
    // 对应 lib/anitabi/source/client.ts 的同步调用
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-api',
    // workflow.ts:94 用 allow404 —— 404 表示该作品无巡礼数据，是正常返回，不是失败。
    allow404: true,
  },
  {
    url: 'https://api.anitabi.cn/bangumi/272510/points/detail',
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-api',
    allow404: false,
  },
  {
    url: 'https://image.anitabi.cn/points/272510/39zlm4tj.jpg?plan=h160',
    // 对应 lib/anitabi/handlers/imageServe.ts 的 render 代理
    userAgent: 'SeichiGoImageRenderProxy/1.0',
    accept: 'image/*,*/*;q=0.8',
    role: 'image-proxy',
    allow404: false,
  },
  {
    url: 'https://img-tc.anitabi.cn/points/272510/39zlm4tj.jpg?plan=h160',
    userAgent: 'SeichiGoImageRenderProxy/1.0',
    accept: 'image/*,*/*;q=0.8',
    role: 'image-proxy',
    allow404: false,
  },
  {
    url: 'https://w.junreimap.com/d/g.json',
    // 对应 lib/anitabi/source/bulkClient.ts 的 bulk 同步抓取
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-bulk',
    allow404: false,
  },
  {
    url: 'https://www.anitabi.cn/d/g.json',
    userAgent: 'seichigo-anitabi-sync/1.0',
    accept: 'application/json',
    role: 'sync-bulk',
    allow404: false,
  },
] as const

// —— 以下常量必须与生产保持一致，否则门槛结论不可用 ——
/** imageServe.ts:16-17 —— /points/ 路径用 8.5s，其余 6s。 */
const RENDER_FETCH_TIMEOUT_MS = 6_000
const POINT_RENDER_FETCH_TIMEOUT_MS = 8_500
/** imageServe.ts:18 —— 超过即 413。 */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** imageServe.ts:203 是 `for (i = 0; i <= MAX_REDIRECTS; i++)`，即最多 6 次 fetch。 */
const MAX_REDIRECTS = 5
/** source/client.ts:3 —— 5xx / 网络错误会重试 3 次；4xx（除 429）不重试。 */
const SYNC_RETRY_DELAYS = [1000, 3000, 8000] as const
/**
 * sync-api 的**每次尝试**超时。生产 fetchWithRetry 不带 AbortSignal（无显式超时），
 * 所以这里取一个宽松值，只为兜住挂死的连接 —— 绝不能比生产更严，否则会造成假失败。
 * 命中它会被单独标记为 probe_timeout，不与「上游不可用」混淆。
 */
const SYNC_ATTEMPT_TIMEOUT_MS = 20_000

/** 与生产 resolveRenderTimeoutMs（imageServe.ts:31-37）同规则；仅用于 image-proxy。 */
function resolveTimeoutMs(target: (typeof UPSTREAM_TARGETS)[number]): number {
  if (target.role !== 'image-proxy') {
    return SYNC_ATTEMPT_TIMEOUT_MS
  }
  const path = new URL(target.url).pathname.toLowerCase()
  return path.includes('/points/')
    ? Math.max(RENDER_FETCH_TIMEOUT_MS, POINT_RENDER_FETCH_TIMEOUT_MS)
    : RENDER_FETCH_TIMEOUT_MS
}

type ProbeResult = {
  url: string
  role: string
  status?: number
  contentType?: string | null
  bytes?: number
  cfRay?: string | null
  eoLogUuid?: string | null
  server?: string | null
  ms: number
  redirects?: number
  retries?: number
  finalUrl?: string
  error?: string
  /** 生产验收结论：仅当生产链路真会把它当成功时才为 true。 */
  usable: boolean
  /** usable 为 false 时说明原因（对应生产的拒绝分支）。 */
  rejectedAs?: string
}

type ColoReport = {
  colo: string
  probedAt: string
  /** 产出该结果时所用的判据版本。旧版本结果不能当门槛数据（见 CRITERIA_VERSION）。 */
  criteriaVersion: string
  results: ProbeResult[]
}

/**
 * 判据版本。**任何改动验收逻辑的修改都必须提升它**，否则旧判据下探测过的 colo
 * 会因 write-if-absent 永久留存、永不重探，把过时结论当成有效门槛数据。
 *
 * v1  status===200 即算可用（错：WAF 挑战页 200+HTML 会被生产拒成 415）
 * v2  加 content-type / JSON 可解析校验，跟随 3xx
 * v3  对齐生产常量（超时 6s/8.5s、25MB、6 次 fetch）、sync-api 重试、allow404
 * v4  每次尝试独立超时（退避不占预算）；超时按角色区分
 *     —— image-proxy → upstream_timeout（真失败），sync-api → probe_timeout（不确定）
 */
const CRITERIA_VERSION = 'v5'

type ProbeEnv = {
  PROBE_STORE: DurableObjectNamespace
  PROBE_SECRET?: string
}

/**
 * DO 仅作存储：write-if-absent，键含判据版本，绝不覆盖同版本结果。
 * 键格式 `report:<criteriaVersion>:<colo>` —— 换版本即自然重探，旧版本结果留作审计。
 */
export class EgressProbeStore {
  private readonly state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const colo = url.searchParams.get('colo') || ''
    const version = url.searchParams.get('v') || ''
    const key = `report:${version}:${colo}`

    if (url.pathname === '/get-colo') {
      const report = await this.state.storage.get<ColoReport>(key)
      return Response.json({ report: report ?? null })
    }

    if (url.pathname === '/put-colo' && request.method === 'POST') {
      const incoming = (await request.json()) as ColoReport
      const existing = await this.state.storage.get<ColoReport>(key)
      if (existing) {
        return Response.json({ report: existing, stored: false })
      }
      await this.state.storage.put(key, incoming)
      return Response.json({ report: incoming, stored: true })
    }

    if (url.pathname === '/list') {
      // 当前版本的结果才是有效门槛数据；旧版本单列出来，明确标为过时。
      const current = await this.state.storage.list<ColoReport>({ prefix: `report:${version}:` })
      const all = await this.state.storage.list<ColoReport>({ prefix: 'report:' })
      const stale = [...all.entries()]
        .filter(([k]) => !k.startsWith(`report:${version}:`))
        .map(([k, v]) => ({
          key: k,
          colo: v.colo,
          probedAt: v.probedAt,
          criteriaVersion: v.criteriaVersion ?? 'pre-v4',
        }))
      return Response.json({ reports: [...current.values()], stale })
    }

    return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

function store(env: ProbeEnv): DurableObjectStub {
  return env.PROBE_STORE.get(env.PROBE_STORE.idFromName('anitabi-egress-probe'))
}

/**
 * 单次尝试：跟随重定向并按生产验收条件判定。不含重试。
 *
 * 判据逐条对齐生产，只有生产会当成功的才 usable：
 *   - imageServe.ts:284-292  content-type 必须 image/*，否则 415（WAF 挑战页正是 200+HTML）
 *   - imageServe.ts:203      `for (i=0; i<=MAX_REDIRECTS; i++)` → 最多 6 次 fetch
 *   - imageServe.ts:445,468  超过 MAX_IMAGE_BYTES → 413
 *   - imageServe.ts:275-282  非 ok 一律 502
 *   - imageServe.ts:31-37    /points/ 超时 8.5s，其余 6s
 *   - source/client.ts:30,36 allow404 时 404 返回 null（正常）；否则非 ok 抛错，且须能 .json()
 */
async function attemptTarget(
  target: (typeof UPSTREAM_TARGETS)[number],
  signal: AbortSignal,
  t0: number,
): Promise<ProbeResult> {
  const base = { url: target.url, role: target.role }
  let current: string = target.url
  // 生产是 i<=MAX_REDIRECTS 的循环，共 MAX_REDIRECTS+1 次 fetch。
  const maxFetches = MAX_REDIRECTS + 1

  for (let attempt = 0; attempt < maxFetches; attempt += 1) {
    // no-store：要测的是上游可达性本身，不能被 Cloudflare 边缘缓存掩盖。
    // 生产在此之上还叠了一层 edge cache，那只会让生产更容易命中，不影响门槛判断。
    const res = await fetch(current, {
      headers: { 'user-agent': target.userAgent, accept: target.accept },
      redirect: 'manual',
      cache: 'no-store',
      signal,
    })

    const meta = {
      ...base,
      status: res.status,
      contentType: res.headers.get('content-type'),
      cfRay: res.headers.get('cf-ray'),
      eoLogUuid: res.headers.get('eo-log-uuid'),
      server: res.headers.get('server'),
      redirects: attempt,
      finalUrl: current,
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) {
        return { ...meta, ms: Date.now() - t0, usable: false, rejectedAs: 'redirect_without_location' }
      }
      try {
        current = new URL(location, current).toString()
      } catch {
        return { ...meta, ms: Date.now() - t0, usable: false, rejectedAs: 'invalid_redirect_location' }
      }
      continue
    }

    // client.ts:30 —— allow404 的端点上 404 表示「无巡礼数据」，生产视为正常（返回 null）。
    if (res.status === 404 && target.allow404) {
      await res.arrayBuffer().catch(() => new ArrayBuffer(0))
      return { ...meta, ms: Date.now() - t0, usable: true, rejectedAs: 'allow404_treated_as_ok' }
    }

    if (!res.ok) {
      const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0))
      return {
        ...meta,
        bytes: body.byteLength,
        ms: Date.now() - t0,
        usable: false,
        rejectedAs: `upstream_status_${res.status}`,
      }
    }

    const mime = String(meta.contentType || '').split(';')[0]?.trim().toLowerCase() ?? ''

    if (target.role === 'image-proxy') {
      // 生产 imageServe.ts:445 会先看 content-length 再看实际字节，超限 413。
      const declaredLength = Number(res.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        return {
          ...meta,
          bytes: declaredLength,
          ms: Date.now() - t0,
          usable: false,
          rejectedAs: `image_too_large_${declaredLength}`,
        }
      }
      const body = await res.arrayBuffer().catch(() => new ArrayBuffer(0))
      if (!mime.startsWith('image/')) {
        return {
          ...meta,
          bytes: body.byteLength,
          ms: Date.now() - t0,
          usable: false,
          rejectedAs: `non_image_content_type:${mime || 'missing'}`,
        }
      }
      if (body.byteLength === 0) {
        return { ...meta, bytes: 0, ms: Date.now() - t0, usable: false, rejectedAs: 'empty_image_body' }
      }
      if (body.byteLength > MAX_IMAGE_BYTES) {
        return {
          ...meta,
          bytes: body.byteLength,
          ms: Date.now() - t0,
          usable: false,
          rejectedAs: `image_too_large_${body.byteLength}`,
        }
      }
      return { ...meta, bytes: body.byteLength, ms: Date.now() - t0, usable: true }
    }

    // sync-api：生产 client.ts:36 会 await res.json()，解析失败即抛。
    const text = await res.text().catch(() => '')
    try {
      JSON.parse(text)
    } catch {
      return {
        ...meta,
        bytes: text.length,
        ms: Date.now() - t0,
        usable: false,
        rejectedAs: `unparseable_json_content_type:${mime || 'missing'}`,
      }
    }
    return { ...meta, bytes: text.length, ms: Date.now() - t0, usable: true }
  }

  return { ...base, ms: Date.now() - t0, usable: false, rejectedAs: 'too_many_redirects' }
}

/** 该失败是否会被生产的 fetchWithRetry 重试（client.ts:46-49）。 */
function isRetriableForSync(result: ProbeResult): boolean {
  const status = result.status
  // 4xx（429 除外）不重试 —— 这正是 403 会让同步在第一个请求就死掉的原因。
  if (status != null && status >= 400 && status < 500 && status !== 429) return false
  // 5xx / 429 / 网络错误会重试。
  return true
}

/**
 * 探测一个目标。sync-api 角色按生产的 fetchWithRetry 语义重试，
 * 否则瞬时 5xx 会被误判为「上游不可用」，产生假阴性。
 *
 * 超时按**每次尝试**独立计时（退避不占预算）—— 生产 fetchWithRetry 不带 AbortSignal，
 * 若像早期版本那样给「整个重试序列」设一个 signal，光 12s 退避就会必然 abort，
 * 把可用的上游误报成 network_error，造成门槛假失败。
 */
async function probeTarget(target: (typeof UPSTREAM_TARGETS)[number]): Promise<ProbeResult> {
  const t0 = Date.now()
  const base = { url: target.url, role: target.role }
  const attemptTimeoutMs = resolveTimeoutMs(target)

  // image-proxy 在生产是单次 fetch（imageServe 无重试）；sync-api 有 3 次退避重试。
  const maxAttempts = target.role === 'sync-api' ? SYNC_RETRY_DELAYS.length + 1 : 1

  let last: ProbeResult | null = null

  for (let i = 0; i < maxAttempts; i += 1) {
    // 每次尝试自己的 controller / timer —— 只约束这一次 fetch，不跨退避。
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs)

    try {
      const result = await attemptTarget(target, controller.signal, t0)
      if (result.usable) {
        return { ...result, retries: i }
      }
      last = { ...result, retries: i }
      if (!isRetriableForSync(result)) break
    } catch (e) {
      const aborted = String((e as Error)?.name) === 'AbortError'
      // 超时的含义按角色不同，不能一概而论：
      //   image-proxy：探针用的就是生产常量（imageServe.ts 的 6s / 8.5s），生产会同样超时
      //     并返回 504「图片代理超时」→ 这是**真实的门槛失败**，标记为 upstream_timeout。
      //   sync-api：生产 fetchWithRetry 不带 AbortSignal（无超时），探针的 20s 只是自我保护
      //     → 超时只说明探针等不下去，不构成门槛证据，标记为 probe_timeout。
      const timeoutKind =
        target.role === 'image-proxy'
          ? `upstream_timeout_${attemptTimeoutMs}ms`
          : `probe_timeout_${attemptTimeoutMs}ms`
      last = {
        ...base,
        error: String((e as Error)?.message ?? e),
        ms: Date.now() - t0,
        usable: false,
        rejectedAs: aborted ? timeoutKind : 'network_error',
        retries: i,
      }
      // 生产把网络错误一并重试，这里同样继续重试（image-proxy maxAttempts=1，自然只跑一次）。
    } finally {
      clearTimeout(timer)
    }

    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, SYNC_RETRY_DELAYS[i]))
    }
  }

  return last ?? { ...base, ms: Date.now() - t0, usable: false, rejectedAs: 'no_attempt', retries: 0 }
}

function resolveColo(request: Request): string {
  const fromCf = (request as Request & { cf?: { colo?: string } }).cf?.colo
  if (fromCf) return String(fromCf)
  const ray = request.headers.get('cf-ray')
  return ray?.split('-')[1] || 'unknown'
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init.headers ?? {}) },
  })
}

export default {
  async fetch(request: Request, env: ProbeEnv): Promise<Response> {
    const url = new URL(request.url)
    const stub = store(env)

    if (url.pathname === '/probe' && request.method === 'POST') {
      const token = String(env.PROBE_SECRET || '').trim()
      const provided = String(request.headers.get('x-probe-secret') || '').trim()
      if (!token || provided !== token) {
        return json({ error: 'unauthorized' }, { status: 401 })
      }

      const colo = resolveColo(request)
      const q = `colo=${encodeURIComponent(colo)}&v=${encodeURIComponent(CRITERIA_VERSION)}`

      // 该 colo 在**当前判据版本**下已探测过 → 直接返回，绝不再打上游。
      // 旧判据版本的结果不算命中（键含版本），所以判据变更后会自然重探。
      const cached = (await (await stub.fetch(`https://do/get-colo?${q}`)).json()) as {
        report: ColoReport | null
      }
      if (cached.report) {
        return json({
          ...cached.report,
          alreadyProbed: true,
          note: `this colo was already probed under criteria ${CRITERIA_VERSION}; upstream NOT contacted`,
        })
      }

      // 在主 Worker fetch handler 内探测 —— 与生产同一执行上下文。
      const results = await Promise.all(UPSTREAM_TARGETS.map(probeTarget))
      const report: ColoReport = {
        colo,
        probedAt: new Date().toISOString(),
        criteriaVersion: CRITERIA_VERSION,
        results,
      }

      // 唯一一次写入（write-if-absent）。此前任何中断都不会留下半状态。
      const put = (await (
        await stub.fetch(`https://do/put-colo?${q}`, {
          method: 'POST',
          body: JSON.stringify(report),
        })
      ).json()) as { report: ColoReport; stored: boolean }

      console.log('[probe] colo', colo, 'stored', put.stored, JSON.stringify(put.report))
      return json({
        ...put.report,
        alreadyProbed: !put.stored,
        note: put.stored
          ? `probe complete from colo ${colo} (main Worker fetch context, production-equivalent)`
          : `a concurrent request already stored colo ${colo}; returning that result`,
      })
    }

    if (url.pathname === '/' && request.method === 'GET') {
      const { reports, stale } = (await (
        await stub.fetch(`https://do/list?v=${encodeURIComponent(CRITERIA_VERSION)}`)
      ).json()) as {
        reports: ColoReport[]
        stale: Array<{ key: string; colo: string; probedAt: string; criteriaVersion: string }>
      }
      const staleNote =
        stale.length > 0
          ? `${stale.length} result(s) from older criteria versions are listed under "stale" and MUST NOT be used as a release gate`
          : undefined

      if (reports.length > 0) {
        return json({
          criteriaVersion: CRITERIA_VERSION,
          coloCount: reports.length,
          reports,
          ...(stale.length > 0 ? { stale, staleNote } : {}),
          cached: true,
        })
      }
      return json(
        {
          status: 'not_probed',
          criteriaVersion: CRITERIA_VERSION,
          hint: 'POST /probe with x-probe-secret. Probe from a few different locations to cover more colos.',
          ...(stale.length > 0 ? { stale, staleNote } : {}),
        },
        { status: 404 },
      )
    }

    return json({ error: 'not_found' }, { status: 404 })
  },
}
