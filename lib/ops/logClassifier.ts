import { createHash } from 'node:crypto'

export type OpsSeverity = 'severe' | 'warning'

export type NormalizedLogRecord = {
  deploymentId: string
  timestamp: Date | null
  requestId: string | null
  path: string | null
  method: string | null
  statusCode: number | null
  message: string
  raw: Record<string, unknown>
}

export type ClassifiedLogEvent = NormalizedLogRecord & {
  severity: OpsSeverity
  fingerprint: string
  reason: string
}

type ClassifyOptions = {
  warn4xxThreshold: number
}

const SEVERE_MESSAGE_PATTERNS = [
  /\buncaught\b/i,
  /\bunhandled\b/i,
  /\bfatal\b/i,
  /\bpanic\b/i,
  /\btimeout\b/i,
  /\bout of memory\b/i,
  /\bsegmentation fault\b/i,
]

const WARNING_MESSAGE_PATTERNS = [
  /\bretry\b/i,
  /\bretrying\b/i,
  /\brecoverable\b/i,
  /\bdegraded\b/i,
  /\bnon[-\s]?fatal\b/i,
  /\brate limit\b/i,
  /\bthrottle\b/i,
]

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return { value }
}

function getByPath(record: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean)
  let current: unknown = record
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function pickFirst(record: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getByPath(record, path)
    if (value != null) return value
  }
  return null
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

function parseDate(value: unknown): Date | null {
  if (value == null) return null

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 2_000_000_000 ? value : value * 1000
    const date = new Date(ms)
    return Number.isFinite(date.getTime()) ? date : null
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      const ms = numeric > 2_000_000_000 ? numeric : numeric * 1000
      const date = new Date(ms)
      if (Number.isFinite(date.getTime())) return date
    }

    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date
  }

  return null
}

function parseStatusCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 100 && value <= 599) return value
    return null
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
      return parsed
    }
  }

  return null
}

function normalizePath(pathValue: string | null): string | null {
  if (!pathValue) return null
  try {
    const url = new URL(pathValue)
    return url.pathname || '/'
  } catch {
    const [first] = pathValue.split('?')
    const cleaned = first.trim()
    if (!cleaned) return null
    if (cleaned.startsWith('/')) return cleaned
    return `/${cleaned}`
  }
}

function normalizeMethod(value: string | null): string | null {
  if (!value) return null
  const method = value.trim().toUpperCase()
  if (!method) return null
  if (!/^[A-Z]+$/.test(method)) return null
  return method
}

function normalizeMessage(value: unknown, raw: Record<string, unknown>): string {
  const direct = normalizeText(value)
  if (direct) return direct

  const fallback = JSON.stringify(raw)
  if (fallback && fallback !== '{}') {
    return fallback.length > 600 ? `${fallback.slice(0, 600)}...` : fallback
  }

  return '(empty log line)'
}

function canonicalizeMessage(input: string): string {
  return input
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{uuid}')
    .replace(/\b\d+\b/g, '{n}')
    .replace(/https?:\/\/\S+/g, '{url}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function buildFingerprintBase(record: NormalizedLogRecord): string {
  const status = record.statusCode == null ? 'status:-' : `status:${record.statusCode}`
  const method = `method:${record.method || '-'}`
  const path = `path:${record.path || '-'}`
  const message = `msg:${canonicalizeMessage(record.message)}`
  return [status, method, path, message].join('|')
}

function hashFingerprint(base: string): string {
  return createHash('sha1').update(base).digest('hex').slice(0, 16)
}

export function buildFingerprint(record: NormalizedLogRecord): string {
  return hashFingerprint(buildFingerprintBase(record))
}

export function normalizeLogRecord(rawValue: unknown, deploymentId: string): NormalizedLogRecord {
  const raw = asRecord(rawValue)

  const messageRaw = pickFirst(raw, [
    'message',
    'text',
    'msg',
    'error.message',
    'payload.message',
    'data.message',
    'line',
  ])

  const statusCode = parseStatusCode(
    pickFirst(raw, ['statusCode', 'status', 'response.statusCode', 'response.status', 'http.status'])
  )

  const path = normalizePath(
    normalizeText(pickFirst(raw, ['path', 'request.path', 'request.url', 'url', 'req.path', 'req.url']))
  )

  const method = normalizeMethod(
    normalizeText(pickFirst(raw, ['method', 'request.method', 'req.method', 'http.method']))
  )

  const requestId = normalizeText(
    pickFirst(raw, ['requestId', 'request.id', 'req.id', 'id', 'traceId', 'request_id'])
  )

  const timestamp = parseDate(
    pickFirst(raw, ['timestamp', 'time', 'createdAt', 'created', 'date', 'ts'])
  )

  return {
    deploymentId,
    timestamp,
    requestId,
    path,
    method,
    statusCode,
    message: normalizeMessage(messageRaw, raw),
    raw,
  }
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

type InitialClassification = {
  kind: 'severe' | 'warning' | '4xx' | 'none'
  reason: string
}

function classifySingle(record: NormalizedLogRecord): InitialClassification {
  if (record.statusCode != null && record.statusCode >= 500) {
    return { kind: 'severe', reason: 'status_5xx' }
  }

  if (matchesAny(record.message, SEVERE_MESSAGE_PATTERNS)) {
    return { kind: 'severe', reason: 'fatal_keyword' }
  }

  if (record.statusCode != null && record.statusCode >= 400 && record.statusCode <= 499) {
    return { kind: '4xx', reason: 'status_4xx' }
  }

  if (matchesAny(record.message, WARNING_MESSAGE_PATTERNS)) {
    return { kind: 'warning', reason: 'warning_keyword' }
  }

  return { kind: 'none', reason: 'ignored' }
}

function toClassified(
  record: NormalizedLogRecord,
  severity: OpsSeverity,
  reason: string
): ClassifiedLogEvent {
  return {
    ...record,
    severity,
    reason,
    fingerprint: buildFingerprint(record),
  }
}

function toTimeMs(value: Date | null): number {
  if (!value) return 0
  const ms = value.getTime()
  return Number.isFinite(ms) ? ms : 0
}

export function sortClassifiedEvents(events: ClassifiedLogEvent[]): ClassifiedLogEvent[] {
  const severityWeight = (severity: OpsSeverity): number => (severity === 'severe' ? 0 : 1)
  return events
    .slice()
    .sort((a, b) => {
      const s = severityWeight(a.severity) - severityWeight(b.severity)
      if (s !== 0) return s

      const t = toTimeMs(b.timestamp) - toTimeMs(a.timestamp)
      if (t !== 0) return t

      if (a.fingerprint < b.fingerprint) return -1
      if (a.fingerprint > b.fingerprint) return 1
      return 0
    })
}

export function classifyNormalizedLogs(
  records: NormalizedLogRecord[],
  options: ClassifyOptions
): ClassifiedLogEvent[] {
  const warn4xxThreshold = Number.isFinite(Number(options.warn4xxThreshold))
    ? Math.max(1, Math.min(1000, Math.floor(Number(options.warn4xxThreshold))))
    : 20

  const out: ClassifiedLogEvent[] = []
  const pending4xx = new Map<string, NormalizedLogRecord[]>()

  for (const record of records) {
    const classification = classifySingle(record)
    if (classification.kind === 'severe') {
      out.push(toClassified(record, 'severe', classification.reason))
      continue
    }

    if (classification.kind === 'warning') {
      out.push(toClassified(record, 'warning', classification.reason))
      continue
    }

    if (classification.kind === '4xx') {
      const fingerprint = buildFingerprint(record)
      const list = pending4xx.get(fingerprint) || []
      list.push(record)
      pending4xx.set(fingerprint, list)
    }
  }

  for (const [, items] of pending4xx.entries()) {
    if (items.length < warn4xxThreshold) continue
    for (const item of items) {
      out.push(toClassified(item, 'warning', `4xx_burst(${items.length})`))
    }
  }

  return sortClassifiedEvents(out)
}
