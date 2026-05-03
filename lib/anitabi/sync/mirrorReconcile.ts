import type { PrismaClient } from '@prisma/client'
import {
  enumerateBangumiCoverVariants,
  enumeratePointImageVariants,
} from '@/lib/anitabi/imageMirrorVariants'
import { computeMirrorKey } from '@/lib/anitabi/imageNormalize'

export type MirrorDiffChange = {
  id: number | string
  field: string
  oldValue: string | null
  newValue: string | null
}

export type MirrorReconcileDiff = {
  bangumiChanges: MirrorDiffChange[]
  pointChanges: MirrorDiffChange[]
}

function normalizeChangedUrl(change: MirrorDiffChange): string | null {
  const next = String(change.newValue || '').trim()
  if (!next) return null

  const prev = String(change.oldValue || '').trim()
  if (prev === next) return null

  return next
}

function inferImageMimeType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'image/png'
  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.avif')) return 'image/avif'
  if (pathname.endsWith('.gif')) return 'image/gif'
  if (pathname.endsWith('.svg')) return 'image/svg+xml'
  return 'image/jpeg'
}

async function reconcileSourceVariants(
  prisma: PrismaClient,
  input: {
    sourceType: 'bangumi-cover' | 'point-image'
    sourceId: string
    variants: Array<{ label: string; url: string }>
  },
): Promise<void> {
  await prisma.mapImageMirrorState.updateMany({
    where: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
    data: {
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      mirroredAt: null,
      contentBytes: null,
    },
  })

  for (const variant of input.variants) {
    const r2Key = await computeMirrorKey(variant.url, inferImageMimeType(variant.url))

    await prisma.mapImageMirrorState.upsert({
      where: {
        sourceType_sourceId_variant: {
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          variant: variant.label,
        },
      },
      create: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        variant: variant.label,
        canonicalUrl: variant.url,
        r2Key,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        mirroredAt: null,
        contentBytes: null,
      },
      update: {
        canonicalUrl: variant.url,
        r2Key,
        status: 'pending',
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        mirroredAt: null,
        contentBytes: null,
      },
    })
  }
}

export async function reconcileMirrorAfterDiff(
  prisma: PrismaClient,
  diff: MirrorReconcileDiff,
): Promise<void> {
  for (const change of diff.bangumiChanges) {
    const nextUrl = normalizeChangedUrl(change)
    if (!nextUrl || change.field !== 'cover') continue

    await reconcileSourceVariants(prisma, {
      sourceType: 'bangumi-cover',
      sourceId: String(change.id),
      variants: enumerateBangumiCoverVariants(nextUrl),
    })
  }

  for (const change of diff.pointChanges) {
    const nextUrl = normalizeChangedUrl(change)
    if (!nextUrl || change.field !== 'image') continue

    await reconcileSourceVariants(prisma, {
      sourceType: 'point-image',
      sourceId: String(change.id),
      variants: enumeratePointImageVariants(nextUrl),
    })
  }
}
