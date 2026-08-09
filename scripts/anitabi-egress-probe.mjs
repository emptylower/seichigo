#!/usr/bin/env node
/**
 * WS0 · 触发 Worker 出口探测（薄客户端）。
 *
 * 探测在 workers/anitabi-egress-probe 的**主 Worker fetch handler** 内进行 ——
 * 与生产抓图（lib/anitabi/handlers/imageServe.ts）、生产同步（lib/anitabi/source/client.ts）
 * 同一执行上下文与出口，所以结果可以当 WS1 的发布门槛。
 * （早期版本把探测放在 Durable Object 里，DO 钉在单一 colo 且上下文不同，不能代表生产。）
 *
 * 结果按 colo + 判据版本分键存储：
 *   - 同一 colo、同一判据版本重复触发 → 直接返回既有结果，不再打上游。
 *   - 判据逻辑一改，worker 里的 CRITERIA_VERSION 就提号，旧结果不再算命中、会自然重探；
 *     GET / 把旧版本结果单列为 stale 并注明不可用于发布判定。
 *   - Worker 在接收请求的 colo 执行，而生产流量遍布全球 colo。**单点 USABLE 不代表全网可用。**
 *     想扩大覆盖面就从不同网络位置各跑一次（换出口节点 / 换地区）。
 *
 * 用法：
 *   PROBE_URL=https://seichigo-anitabi-egress-probe.<你的子域>.workers.dev \
 *   PROBE_SECRET=<与 worker 一致> \
 *   node scripts/anitabi-egress-probe.mjs
 *
 * PROBE_URL 从 `npx wrangler deploy` 的输出里复制（workers.dev 地址含账号子域，
 * 无法凭 worker 名推断）；若配了自定义域名也可直接用。
 */

const PROBE_URL = String(process.env.PROBE_URL || '').trim().replace(/\/+$/, '')
const PROBE_SECRET = String(process.env.PROBE_SECRET || '').trim()

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

if (!PROBE_URL) {
  fail(
    'PROBE_URL is required — copy the deployed URL from `npx wrangler deploy` output.\n' +
      '  e.g. PROBE_URL=https://seichigo-anitabi-egress-probe.<subdomain>.workers.dev',
  )
}
if (!/^https:\/\//.test(PROBE_URL)) {
  fail(`PROBE_URL must be an https URL, got: ${PROBE_URL}`)
}
if (!PROBE_SECRET) {
  fail('PROBE_SECRET is required (must match the worker secret set via `wrangler secret put PROBE_SECRET`).')
}

const res = await fetch(`${PROBE_URL}/probe`, {
  method: 'POST',
  headers: { 'x-probe-secret': PROBE_SECRET },
})

const body = await res.json().catch(async () => ({ raw: await res.text().catch(() => '') }))

if (res.status === 401) fail('unauthorized — PROBE_SECRET does not match the worker secret.')
if (!res.ok) fail(`[probe] failed ${res.status}: ${JSON.stringify(body)}`)

if (body.alreadyProbed) {
  console.log(
    `[probe] colo ${body.colo} was already probed under criteria ${body.criteriaVersion} —` +
      ' stored result returned (upstream NOT contacted again).\n',
  )
} else {
  console.log(
    `[probe] probe complete from colo ${body.colo} (main Worker fetch context, criteria ${body.criteriaVersion}).\n`,
  )
}

console.log(JSON.stringify(body, null, 2))

console.log(`\n--- 判读（colo ${body.colo}，判据 ${body.criteriaVersion}） ---`)
console.log('  判据与生产一致：image 必须 image/* 且非空且 ≤25MB；api 必须可 JSON.parse；')
console.log('  3xx 跟随（≤6 次 fetch）；sync-api 按生产重试 5xx/429；/lite 的 404 视为正常。')
console.log('  超时分两类：upstream_timeout=用生产常量、生产同样会 504（真失败）；')
console.log('             probe_timeout=生产此处无超时、仅探针自我保护（不确定）。\n')
let imgTc = null
for (const r of body.results ?? []) {
  const host = (() => {
    try {
      return new URL(r.url).hostname
    } catch {
      return r.url
    }
  })()
  // usable 才算可用 —— HTTP 200 + text/html（WAF 挑战页）在生产会被拒成 415。
  const verdict = r.usable ? 'USABLE' : `UNUSABLE(${r.rejectedAs ?? 'unknown'})`
  const status = String(r.status ?? r.error ?? '-')
  const extra = [
    r.redirects ? `${r.redirects}redir` : '',
    r.retries ? `${r.retries}retry` : '',
    r.bytes != null ? `${r.bytes}B` : '',
  ]
    .filter(Boolean)
    .join(' ')
  console.log(`  ${verdict.padEnd(42)} ${status.padEnd(6)} ${host.padEnd(22)} ${extra}`)
  if (host === 'img-tc.anitabi.cn') imgTc = r
}

console.log('')
// probe_timeout 只出现在 sync-api（生产无超时，探针自我保护）→ 不确定。
// upstream_timeout 出现在 image-proxy（探针用生产常量，生产同样会 504）→ 真实失败。
const isProbeTimeout = (r) => String(r?.rejectedAs || '').startsWith('probe_timeout')
const isUpstreamTimeout = (r) => String(r?.rejectedAs || '').startsWith('upstream_timeout')

if (imgTc?.usable) {
  console.log('img-tc 可用（真实 image/* 响应）→ 该 colo 上 WS1 可走服务端代理 + R2 镜像。')
} else if (imgTc && isUpstreamTimeout(imgTc)) {
  console.log(
    `img-tc 超时（${imgTc.rejectedAs}）→ **门槛失败**。` +
      '\n  探针用的就是生产超时常量（imageServe.ts 的 6s / 8.5s），生产会同样超时并返回 504。' +
      '\n  → WS1 需降级为浏览器直连（见 spec WS1.4）。',
  )
} else if (imgTc) {
  console.log(
    `img-tc 不可用（${imgTc.rejectedAs}，HTTP ${imgTc.status ?? imgTc.error}）` +
      ' → WS1 需降级为浏览器直连（见 spec WS1.4）。',
  )
  if (String(imgTc.rejectedAs || '').startsWith('non_image_content_type')) {
    console.log('  注意：上游返回了 HTTP 200 但不是图片（很可能是 WAF 挑战页），生产会拒成 415。')
  }
} else {
  console.log('未拿到 img-tc 结果 → 结论不确定，请重跑。')
}

const apiResults = (body.results ?? []).filter((r) => r.role === 'sync-api')
const apiUsable = apiResults.filter((r) => r.usable).length
console.log(`api.anitabi.cn 可用端点：${apiUsable}/${apiResults.length}（>0 则 D2 的选项会变简单）`)
const allow404 = apiResults.filter((r) => r.rejectedAs === 'allow404_treated_as_ok').length
if (allow404 > 0) {
  console.log(`  其中 ${allow404} 个是 404 但生产用 allow404 视为正常（该作品无巡礼数据）。`)
}
const inconclusive = (body.results ?? []).filter(isProbeTimeout)
if (inconclusive.length > 0) {
  console.log(
    `\n⚠ ${inconclusive.length} 个 sync-api 目标是**探针超时**（生产此处无超时限制），` +
      '结论不确定、不能当门槛失败证据 —— 请重跑确认。',
  )
}

console.log(
  '\n⚠ 这是单个 colo 的结论。生产流量遍布全球 colo，' +
    '换网络位置再跑几次以扩大覆盖面，再据此定 WS1 走法。',
)
console.log(`   已累积结果：GET ${PROBE_URL}/`)
console.log(`   探测完成后删除：npx wrangler delete --name seichigo-anitabi-egress-probe`)
