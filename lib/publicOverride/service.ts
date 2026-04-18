import { prisma } from '@/lib/db/prisma'
import { normalizeArticleSlug } from '@/lib/article/slug'

export type PublicOverrideTargetType = 'post' | 'resource'
export type PublicOverrideAction = 'hide' | 'redirect' | 'replace-with-emergency-copy'

export type PublicOverrideRecord = {
  id: string
  targetType: PublicOverrideTargetType
  targetKey: string
  locale: string | null
  action: PublicOverrideAction
  redirectUrl: string | null
  title: string | null
  bodyText: string | null
  ctaLabel: string | null
  ctaHref: string | null
  expiresAt: string
  rollbackSnapshotVersion: string
  note: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export type PublicOverrideInput = {
  targetType: PublicOverrideTargetType
  targetKey: string
  locale?: string | null
  action: PublicOverrideAction
  redirectUrl?: string | null
  title?: string | null
  bodyText?: string | null
  ctaLabel?: string | null
  ctaHref?: string | null
  expiresAt: string
  rollbackSnapshotVersion: string
  note?: string | null
}

type RawPublicOverride = {
  id: string
  targetType: string
  targetKey: string
  locale: string | null
  action: string
  redirectUrl: string | null
  title: string | null
  bodyText: string | null
  ctaLabel: string | null
  ctaHref: string | null
  expiresAt: Date | string
  rollbackSnapshotVersion: string
  note: string | null
  createdById: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

const ALLOWED_TARGET_TYPES = new Set<PublicOverrideTargetType>(['post', 'resource'])
const ALLOWED_ACTIONS = new Set<PublicOverrideAction>(['hide', 'redirect', 'replace-with-emergency-copy'])
let hasLoggedOverrideFallback = false

function shouldBypassPublicOverrideLookupAtBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function assertNoHtml(name: string, value: string | null) {
  if (!value) return
  if (/[<>]/.test(value)) {
    throw new Error(`${name} 不允许包含 HTML`)
  }
}

function normalizeLocale(value: unknown): string | null {
  const locale = normalizeText(value)
  if (!locale) return null
  if (!['zh', 'en', 'ja'].includes(locale)) {
    throw new Error('locale 仅支持 zh/en/ja')
  }
  return locale
}

function normalizeTargetKey(targetType: PublicOverrideTargetType, value: unknown): string {
  const key = normalizeText(value)
  if (!key) throw new Error('targetKey 不能为空')
  return targetType === 'post' ? normalizeArticleSlug(key) : key
}

function normalizeUrl(name: string, value: unknown): string | null {
  const raw = normalizeNullableText(value)
  if (!raw) return null
  if (raw.startsWith('/')) return raw

  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    // fall through
  }

  throw new Error(`${name} 必须是站内路径或 http/https URL`)
}

function toIsoString(input: Date | string): string {
  const date = input instanceof Date ? input : new Date(input)
  return date.toISOString()
}

function mapRecord(record: RawPublicOverride): PublicOverrideRecord {
  return {
    id: record.id,
    targetType: record.targetType as PublicOverrideTargetType,
    targetKey: record.targetKey,
    locale: record.locale,
    action: record.action as PublicOverrideAction,
    redirectUrl: record.redirectUrl,
    title: record.title,
    bodyText: record.bodyText,
    ctaLabel: record.ctaLabel,
    ctaHref: record.ctaHref,
    expiresAt: toIsoString(record.expiresAt),
    rollbackSnapshotVersion: record.rollbackSnapshotVersion,
    note: record.note,
    createdById: record.createdById,
    createdAt: toIsoString(record.createdAt),
    updatedAt: toIsoString(record.updatedAt),
  }
}

export function validatePublicOverrideInput(input: PublicOverrideInput) {
  const targetType = normalizeText(input.targetType) as PublicOverrideTargetType
  if (!ALLOWED_TARGET_TYPES.has(targetType)) {
    throw new Error('targetType 仅支持 post/resource')
  }

  const action = normalizeText(input.action) as PublicOverrideAction
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error('action 仅支持 hide/redirect/replace-with-emergency-copy')
  }

  const expiresAt = new Date(input.expiresAt)
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error('expiresAt 必须是合法 ISO 时间')
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('expiresAt 必须晚于当前时间')
  }

  const rollbackSnapshotVersion = normalizeText(input.rollbackSnapshotVersion)
  if (!rollbackSnapshotVersion) {
    throw new Error('rollbackSnapshotVersion 不能为空')
  }

  const normalized = {
    targetType,
    targetKey: normalizeTargetKey(targetType, input.targetKey),
    locale: normalizeLocale(input.locale),
    action,
    redirectUrl: normalizeUrl('redirectUrl', input.redirectUrl),
    title: normalizeNullableText(input.title),
    bodyText: normalizeNullableText(input.bodyText),
    ctaLabel: normalizeNullableText(input.ctaLabel),
    ctaHref: normalizeUrl('ctaHref', input.ctaHref),
    expiresAt,
    rollbackSnapshotVersion,
    note: normalizeNullableText(input.note),
  }

  if (normalized.ctaLabel && !normalized.ctaHref) {
    throw new Error('ctaLabel 与 ctaHref 需要同时提供')
  }
  if (normalized.ctaHref && !normalized.ctaLabel) {
    throw new Error('ctaHref 与 ctaLabel 需要同时提供')
  }

  assertNoHtml('title', normalized.title)
  assertNoHtml('bodyText', normalized.bodyText)
  assertNoHtml('ctaLabel', normalized.ctaLabel)

  if (action === 'hide') {
    return normalized
  }

  if (action === 'redirect') {
    if (!normalized.redirectUrl) throw new Error('redirectUrl 为必填')
    return normalized
  }

  if (!normalized.title || !normalized.bodyText) {
    throw new Error('replace-with-emergency-copy 需要 title 与 bodyText')
  }

  return normalized
}

export function pickBestOverride(
  records: PublicOverrideRecord[],
  localePreference: string[]
): PublicOverrideRecord | null {
  if (!records.length) return null

  const localeRank = new Map<string | null, number>()
  localePreference.forEach((locale, index) => localeRank.set(locale, index))
  localeRank.set(null, localePreference.length + 1)

  return [...records].sort((left, right) => {
    const leftRank = localeRank.get(left.locale) ?? localePreference.length + 2
    const rightRank = localeRank.get(right.locale) ?? localePreference.length + 2
    if (leftRank !== rightRank) return leftRank - rightRank
    return right.updatedAt.localeCompare(left.updatedAt)
  })[0] ?? null
}

async function findOverrides(targetType: PublicOverrideTargetType, targetKeys: string[], locales: (string | null)[]) {
  if (!targetKeys.length) return []
  if (shouldBypassPublicOverrideLookupAtBuild()) return []

  const rows = await prisma.publicOverride.findMany({
    where: {
      targetType,
      targetKey: { in: targetKeys },
      expiresAt: { gt: new Date() },
      OR: locales.map((locale) => ({ locale })),
    },
    orderBy: { updatedAt: 'desc' },
  }).catch((error) => {
    if (!hasLoggedOverrideFallback) {
      hasLoggedOverrideFallback = true
      console.warn('[publicOverride] findMany fallback to empty', error)
    }
    return []
  })

  return rows.map((row) => mapRecord(row as RawPublicOverride))
}

export async function resolvePublicOverrideForPost(slug: string, locale: string): Promise<PublicOverrideRecord | null> {
  const raw = normalizeText(slug)
  if (!raw) return null

  const normalized = normalizeArticleSlug(raw)
  const keys = Array.from(new Set([raw, normalized].filter(Boolean)))
  const locales = Array.from(new Set([normalizeLocale(locale), locale === 'zh' ? null : 'zh', null]))
  const matches = await findOverrides('post', keys, locales)
  return pickBestOverride(matches, locales.filter((value): value is string => typeof value === 'string'))
}

export async function resolvePublicOverrideForResource(id: string, locale: string): Promise<PublicOverrideRecord | null> {
  const key = normalizeText(id)
  if (!key) return null

  const locales = Array.from(new Set([normalizeLocale(locale), null]))
  const matches = await findOverrides('resource', [key], locales)
  return pickBestOverride(matches, locales.filter((value): value is string => typeof value === 'string'))
}

export async function listPublicOverrides() {
  const rows = await prisma.publicOverride.findMany({
    orderBy: [{ expiresAt: 'desc' }, { updatedAt: 'desc' }],
  })

  return rows.map((row) => mapRecord(row as RawPublicOverride))
}

export async function createPublicOverride(input: PublicOverrideInput, createdById: string | null) {
  const normalized = validatePublicOverrideInput(input)

  const created = await prisma.publicOverride.create({
    data: {
      targetType: normalized.targetType,
      targetKey: normalized.targetKey,
      locale: normalized.locale,
      action: normalized.action,
      redirectUrl: normalized.redirectUrl,
      title: normalized.title,
      bodyText: normalized.bodyText,
      ctaLabel: normalized.ctaLabel,
      ctaHref: normalized.ctaHref,
      expiresAt: normalized.expiresAt,
      rollbackSnapshotVersion: normalized.rollbackSnapshotVersion,
      note: normalized.note,
      createdById,
    },
  })

  return mapRecord(created as RawPublicOverride)
}

export async function deletePublicOverride(id: string) {
  const key = normalizeText(id)
  if (!key) throw new Error('id 不能为空')
  const deleted = await prisma.publicOverride.delete({ where: { id: key } })
  return mapRecord(deleted as RawPublicOverride)
}

export function getAffectedPublicPaths(targetType: PublicOverrideTargetType, targetKey: string) {
  if (targetType === 'resource') {
    const encoded = encodeURIComponent(targetKey)
    return [`/resources/${encoded}`, `/en/resources/${encoded}`, `/ja/resources/${encoded}`]
  }

  const encoded = encodeURIComponent(targetKey)
  return [`/posts/${encoded}`, `/en/posts/${encoded}`, `/ja/posts/${encoded}`]
}
