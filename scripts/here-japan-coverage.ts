/**
 * Phase 1 spike: HERE Public Transit v8 coverage in Japan.
 *
 * Self-contained — does NOT import from the main codebase.
 * Reads HERE_API_KEY from .env.local (via Node's `--env-file` flag, Node 22+).
 *
 * Usage:
 *   npm run route:here-spike
 *   # or directly:
 *   npx tsx --env-file=.env.local scripts/here-japan-coverage.ts
 *
 * What it does:
 *   1. For each of the 10 hardcoded OD pairs (docs/in-app-navigation-roadmap.md §3),
 *      calls HERE Transit /v8/routes with `return=polyline,intermediate,fares,travelSummary`.
 *   2. Dumps the raw JSON response to .cache/here-spike/pair-NN.json
 *      (.cache/ is already in .gitignore).
 *   3. Extracts the dump fields requested by the roadmap:
 *      transport.mode, transport.name, transport.shortName, agency.name,
 *      departure.place.name, arrival.place.name, polyline length.
 *   4. Runs a fuzzy heuristic: does any returned transit section's
 *      line/agency name contain any of the expected operator tokens?
 *   5. Prints a markdown decision report to stdout and exits 0/1
 *      against the decision gate (9-10/10 = GO, 6-8/10 = REVIEW, ≤5/10 = HALT).
 *
 * Geocoding is intentionally NOT in scope — coordinates for the 10 stations are
 * hardcoded below (sourced from OpenStreetMap). Phase 2 will handle station
 * resolution separately.
 *
 * Driving / walking / cycling coverage is treated as a given — HERE Routing v8
 * works globally and is not the unknown. Transit is the only mode being
 * validated here.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface LatLng {
  lat: number
  lng: number
}

interface OdPair {
  index: number
  originName: string
  destinationName: string
  origin: LatLng
  destination: LatLng
  expectedOperators: string[] // OR semantics; tokens that should appear in some section
  notes?: string
}

const OD_PAIRS: OdPair[] = [
  {
    index: 1,
    originName: '新宿駅',
    destinationName: '渋谷駅',
    origin: { lat: 35.6896, lng: 139.7006 },
    destination: { lat: 35.6580, lng: 139.7016 },
    expectedOperators: ['山手線', 'Yamanote', '副都心線', 'Fukutoshin'],
  },
  {
    index: 2,
    originName: '東京駅',
    destinationName: '京都駅',
    origin: { lat: 35.6812, lng: 139.7671 },
    destination: { lat: 34.9858, lng: 135.7588 },
    expectedOperators: ['東海道新幹線', 'Tokaido', 'Shinkansen', '新幹線'],
  },
  {
    index: 3,
    originName: '渋谷駅',
    destinationName: '鎌倉駅',
    origin: { lat: 35.6580, lng: 139.7016 },
    destination: { lat: 35.3192, lng: 139.5503 },
    expectedOperators: ['横須賀線', 'Yokosuka', '湘南新宿', 'Shonan-Shinjuku'],
  },
  {
    index: 4,
    originName: '関西空港',
    destinationName: '京都駅',
    origin: { lat: 34.4347, lng: 135.2440 },
    destination: { lat: 34.9858, lng: 135.7588 },
    expectedOperators: ['はるか', 'Haruka', '京都市営地下鉄', 'Karasuma', '烏丸線'],
    notes: 'multi-leg expected: 特急はるか + transfer',
  },
  {
    index: 5,
    originName: '札幌駅',
    destinationName: '大通駅',
    origin: { lat: 43.0686, lng: 141.3508 },
    destination: { lat: 43.0612, lng: 141.3540 },
    expectedOperators: ['南北線', 'Namboku', '札幌市営地下鉄', 'Sapporo Subway'],
  },
  {
    index: 6,
    originName: '博多駅',
    destinationName: '天神駅',
    origin: { lat: 33.5904, lng: 130.4207 },
    destination: { lat: 33.5915, lng: 130.4006 },
    expectedOperators: ['空港線', 'Kuko', '福岡市地下鉄', 'Fukuoka Subway'],
  },
  {
    index: 7,
    originName: '名古屋駅',
    destinationName: '栄駅',
    origin: { lat: 35.1709, lng: 136.8815 },
    destination: { lat: 35.1700, lng: 136.9081 },
    expectedOperators: ['東山線', 'Higashiyama', '名古屋市営地下鉄', 'Nagoya Subway'],
  },
  {
    index: 8,
    originName: '池袋駅',
    destinationName: '川越駅',
    origin: { lat: 35.7295, lng: 139.7109 },
    destination: { lat: 35.9081, lng: 139.4856 },
    expectedOperators: ['東武東上線', 'Tobu Tojo', '川越線', 'Kawagoe'],
  },
  {
    index: 9,
    originName: '大阪駅',
    destinationName: '神戸三宮駅',
    origin: { lat: 34.7024, lng: 135.4959 },
    destination: { lat: 34.6940, lng: 135.1955 },
    expectedOperators: ['神戸線', 'Kobe Line', '東海道', '阪急', 'Hankyu'],
  },
  {
    index: 10,
    originName: '上野駅',
    destinationName: '軽井沢駅',
    origin: { lat: 35.7138, lng: 139.7770 },
    destination: { lat: 36.3429, lng: 138.6357 },
    expectedOperators: ['北陸新幹線', 'Hokuriku', 'Shinkansen', '新幹線'],
  },
]

interface HereTransport {
  mode?: string
  name?: string
  shortName?: string
  category?: string
  color?: string
  textColor?: string
  headsign?: string
}

interface HereAgency {
  name?: string
  website?: string
}

interface HerePlace {
  name?: string
  location?: { lat: number; lng: number }
  type?: string
}

interface HereSection {
  id?: string
  type?: string // 'transit' | 'pedestrian' | ...
  transport?: HereTransport
  agency?: HereAgency
  departure?: { time?: string; place?: HerePlace }
  arrival?: { time?: string; place?: HerePlace }
  travelSummary?: { duration?: number; length?: number }
  polyline?: string
  intermediateStops?: Array<{ departure?: { place?: HerePlace }; arrival?: { place?: HerePlace } }>
}

interface HereRoute {
  id?: string
  sections?: HereSection[]
}

interface HereTransitResponse {
  routes?: HereRoute[]
  notices?: Array<{ code?: string; title?: string }>
}

interface HereErrorBody {
  status?: number
  title?: string
  cause?: string
  action?: string
  requestId?: string
}

interface SectionSummary {
  type?: string
  mode?: string
  lineName?: string
  shortName?: string
  agency?: string
  headsign?: string
  fromStop?: string
  toStop?: string
  durationSec?: number
  distanceM?: number
  polylineChars?: number
  intermediateStopCount?: number
}

interface PairResult {
  pair: OdPair
  ok: boolean
  routeCount: number
  matched: boolean
  matchedToken: string | null
  alternatives: Array<{
    sections: SectionSummary[]
  }>
  errorTitle?: string
  errorCause?: string
}

const HERE_TRANSIT_ENDPOINT = 'https://transit.router.hereapi.com/v8/routes'
const CACHE_DIR = resolve(process.cwd(), '.cache/here-spike')

function nextWeekdayMorningJst(): string {
  // Pick the next upcoming Wednesday at 09:30 JST. Wednesday avoids weekend
  // schedules and Monday/Friday edge cases. 09:30 captures rush-hour service
  // density which is the realistic worst case for transit coverage tests.
  const now = new Date()
  // Walk forward day-by-day until we hit Wednesday in UTC; offset handled below.
  const target = new Date(now)
  target.setUTCDate(target.getUTCDate() + 1)
  while (target.getUTCDay() !== 3) {
    target.setUTCDate(target.getUTCDate() + 1)
  }
  // 09:30 JST = 00:30 UTC.
  target.setUTCHours(0, 30, 0, 0)
  // Format as ISO 8601 with +09:00 offset for clarity in logs.
  const jst = new Date(target.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
    `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:00+09:00`
  )
}

function normalize(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, '').toLowerCase()
}

function tokenMatch(haystack: string, needle: string): boolean {
  const h = normalize(haystack)
  const n = normalize(needle)
  if (!h || !n) return false
  return h.includes(n)
}

function summarizeSection(section: HereSection): SectionSummary {
  return {
    type: section.type,
    mode: section.transport?.mode,
    lineName: section.transport?.name,
    shortName: section.transport?.shortName,
    agency: section.agency?.name,
    headsign: section.transport?.headsign,
    fromStop: section.departure?.place?.name,
    toStop: section.arrival?.place?.name,
    durationSec: section.travelSummary?.duration,
    distanceM: section.travelSummary?.length,
    polylineChars: section.polyline ? section.polyline.length : undefined,
    intermediateStopCount: section.intermediateStops?.length,
  }
}

function checkMatch(pair: OdPair, routes: HereRoute[]): { matched: boolean; token: string | null } {
  for (const route of routes) {
    for (const section of route.sections ?? []) {
      if (section.type !== 'transit') continue
      const candidate = [
        section.transport?.name,
        section.transport?.shortName,
        section.transport?.category,
        section.transport?.headsign,
        section.agency?.name,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join(' | ')
      for (const expected of pair.expectedOperators) {
        if (tokenMatch(candidate, expected)) {
          return { matched: true, token: expected }
        }
      }
    }
  }
  return { matched: false, token: null }
}

async function callHereTransit(
  apiKey: string,
  pair: OdPair,
  departureTime: string,
): Promise<{ response: HereTransitResponse | null; httpStatus: number; raw: string; error?: HereErrorBody }> {
  const params = new URLSearchParams({
    origin: `${pair.origin.lat},${pair.origin.lng}`,
    destination: `${pair.destination.lat},${pair.destination.lng}`,
    departureTime,
    return: 'polyline,intermediate,fares,travelSummary',
    lang: 'ja-JP',
    alternatives: '2',
    apiKey,
  })
  const url = `${HERE_TRANSIT_ENDPOINT}?${params.toString()}`
  const res = await fetch(url, { method: 'GET' })
  const raw = await res.text()
  if (!res.ok) {
    let error: HereErrorBody | undefined
    try {
      error = JSON.parse(raw) as HereErrorBody
    } catch {
      error = { title: `HTTP ${res.status}`, cause: raw.slice(0, 200) }
    }
    return { response: null, httpStatus: res.status, raw, error }
  }
  const parsed = JSON.parse(raw) as HereTransitResponse
  return { response: parsed, httpStatus: res.status, raw }
}

async function processPair(
  apiKey: string,
  pair: OdPair,
  departureTime: string,
): Promise<PairResult> {
  process.stdout.write(`\nPair ${pair.index}/10: ${pair.originName} → ${pair.destinationName}\n`)
  process.stdout.write(`  expected: ${pair.expectedOperators.join(' OR ')}\n`)
  if (pair.notes) process.stdout.write(`  note: ${pair.notes}\n`)

  let response: HereTransitResponse | null = null
  let raw = ''
  let errorTitle: string | undefined
  let errorCause: string | undefined
  try {
    const result = await callHereTransit(apiKey, pair, departureTime)
    response = result.response
    raw = result.raw
    if (result.error) {
      errorTitle = result.error.title
      errorCause = result.error.cause
    }
  } catch (err) {
    errorTitle = 'fetch failed'
    errorCause = err instanceof Error ? err.message : String(err)
  }

  // Persist raw dump for human review (even on errors).
  const dumpPath = resolve(CACHE_DIR, `pair-${String(pair.index).padStart(2, '0')}.json`)
  const payload = {
    pair,
    departureTime,
    httpError: errorTitle ? { title: errorTitle, cause: errorCause } : null,
    response,
    rawIfUnparsed: response ? undefined : raw,
  }
  writeFileSync(dumpPath, JSON.stringify(payload, null, 2), 'utf8')

  if (!response) {
    process.stdout.write(`  ✗ HERE error: ${errorTitle ?? 'unknown'}${errorCause ? ` — ${errorCause}` : ''}\n`)
    return {
      pair,
      ok: false,
      routeCount: 0,
      matched: false,
      matchedToken: null,
      alternatives: [],
      errorTitle,
      errorCause,
    }
  }

  const routes = response.routes ?? []
  if (routes.length === 0) {
    const notice = response.notices?.[0]
    process.stdout.write(`  ✗ no routes returned${notice ? ` (notice: ${notice.code ?? ''} ${notice.title ?? ''})` : ''}\n`)
    return {
      pair,
      ok: false,
      routeCount: 0,
      matched: false,
      matchedToken: null,
      alternatives: [],
      errorTitle: notice?.title,
      errorCause: notice?.code,
    }
  }

  const alternatives = routes.map((route) => ({
    sections: (route.sections ?? []).map(summarizeSection),
  }))

  // Print compact human-readable summary of best (first) alternative.
  const best = alternatives[0]
  const transitLegs = best.sections.filter((s) => s.type === 'transit')
  process.stdout.write(`  ✓ ${routes.length} alternative(s)\n`)
  process.stdout.write(`    [0] ${transitLegs.length} transit leg(s):\n`)
  for (const leg of transitLegs) {
    const line = leg.lineName ?? leg.shortName ?? '(unnamed)'
    const agency = leg.agency ? ` / ${leg.agency}` : ''
    const stops = leg.intermediateStopCount != null ? `, ${leg.intermediateStopCount} intermediate stops` : ''
    const poly = leg.polylineChars != null ? `, polyline=${leg.polylineChars} chars` : ''
    process.stdout.write(`        - ${line}${agency}: ${leg.fromStop ?? '?'} → ${leg.toStop ?? '?'}${stops}${poly}\n`)
  }

  const match = checkMatch(pair, routes)
  if (match.matched) {
    process.stdout.write(`  ✅ matched expected token: "${match.token}"\n`)
  } else {
    process.stdout.write(`  ⚠️  no expected token matched (raw dump → ${dumpPath})\n`)
  }

  return {
    pair,
    ok: true,
    routeCount: routes.length,
    matched: match.matched,
    matchedToken: match.token,
    alternatives,
  }
}

function decisionGate(matchedCount: number): { code: 'GO' | 'REVIEW' | 'HALT'; message: string } {
  if (matchedCount >= 9) {
    return { code: 'GO', message: 'HERE Transit is GO for Phase 2 (9-10/10 per roadmap §3 decision gate).' }
  }
  if (matchedCount >= 6) {
    return {
      code: 'REVIEW',
      message:
        'HERE Transit needs human review (6-8/10). Inspect which pairs failed; if failures are not in core Tokyo/Osaka/Kyoto, still safe to proceed. Otherwise evaluate NAVITIME fallback.',
    }
  }
  return { code: 'HALT', message: 'HERE Transit coverage insufficient (≤5/10). Activate NAVITIME fallback per roadmap §3.' }
}

async function main(): Promise<number> {
  const apiKey = process.env.HERE_API_KEY
  if (!apiKey) {
    process.stderr.write(
      [
        '✗ HERE_API_KEY is not set.',
        '',
        '  1. Sign up for HERE Freemium: https://developer.here.com/sign-up?create=Freemium-Basic',
        '  2. Create a REST API key under "Access Manager".',
        '  3. Add to .env.local:   HERE_API_KEY=<your-key>',
        '  4. Re-run with:         npm run route:here-spike',
        '',
      ].join('\n'),
    )
    return 2
  }

  mkdirSync(CACHE_DIR, { recursive: true })

  const departureTime = nextWeekdayMorningJst()
  process.stdout.write('🚆 HERE Japan Transit Coverage Spike\n')
  process.stdout.write('====================================\n')
  process.stdout.write(`departureTime: ${departureTime}\n`)
  process.stdout.write(`endpoint:      ${HERE_TRANSIT_ENDPOINT}\n`)
  process.stdout.write(`dump dir:      ${CACHE_DIR}\n`)

  const results: PairResult[] = []
  for (const pair of OD_PAIRS) {
    const result = await processPair(apiKey, pair, departureTime)
    results.push(result)
    // Be polite to the Freemium tier — 250k tx/month is plenty but no need to burst.
    await new Promise((r) => setTimeout(r, 300))
  }

  // Aggregate.
  const matchedCount = results.filter((r) => r.matched).length
  const errorCount = results.filter((r) => !r.ok).length
  const noRouteCount = results.filter((r) => r.ok && r.routeCount === 0).length

  process.stdout.write('\n====================================\n')
  process.stdout.write('Summary\n')
  process.stdout.write('====================================\n')
  for (const r of results) {
    const status = r.matched ? '✅' : r.ok ? '⚠️ ' : '✗ '
    const detail = r.matched
      ? `matched "${r.matchedToken}"`
      : r.ok
        ? `${r.routeCount} route(s), no expected token`
        : `error: ${r.errorTitle ?? 'unknown'}`
    process.stdout.write(
      `  ${status} ${r.pair.index}. ${r.pair.originName} → ${r.pair.destinationName}: ${detail}\n`,
    )
  }
  process.stdout.write(`\nMatched: ${matchedCount}/10\n`)
  process.stdout.write(`Errors:  ${errorCount}/10\n`)
  process.stdout.write(`No-route (HTTP 200 but empty): ${noRouteCount}/10\n`)

  // Save aggregate report for follow-up.
  const reportPath = resolve(CACHE_DIR, 'report.json')
  writeFileSync(
    reportPath,
    JSON.stringify({ departureTime, results, matchedCount, errorCount, noRouteCount }, null, 2),
    'utf8',
  )
  process.stdout.write(`\nFull aggregate report: ${reportPath}\n`)

  const gate = decisionGate(matchedCount)
  process.stdout.write(`\nDECISION (${gate.code}): ${gate.message}\n`)

  // Exit code conventions for CI / scripted re-runs.
  // 0 = GO, 1 = REVIEW, 2 = config error (missing key), 3 = HALT.
  if (gate.code === 'GO') return 0
  if (gate.code === 'REVIEW') return 1
  return 3
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
    process.exit(1)
  })
