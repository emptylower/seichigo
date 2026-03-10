import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'
import { safeRevalidatePath } from '@/lib/next/revalidate'
import {
  buildBangumiSourceHash,
  buildPointSourceHash,
} from '@/lib/translation/mapSourceHash'

export type ApproveMutationResult = {
  finalContent: unknown
  sourceHash: string | null
  revalidateSlug?: string | null
  revalidateCitySlug?: string | null
}

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function normalizeArticleDraftContent(
  draftContent: unknown
): Record<string, unknown> {
  const draftData =
    draftContent && typeof draftContent === 'object'
      ? { ...(draftContent as Record<string, unknown>) }
      : {}
  const contentJson = draftData.contentJson
  if (contentJson && typeof contentJson === 'object') {
    draftData.contentHtml = renderArticleContentHtmlFromJson(contentJson)
  }
  return draftData
}

export function isEmptyDocContentJson(contentJson: unknown): boolean {
  if (!contentJson || typeof contentJson !== 'object') return true
  const doc = contentJson as { content?: unknown }
  return !Array.isArray(doc.content) || doc.content.length === 0
}

export function revalidateArticlePaths(slug: string | null | undefined) {
  safeRevalidatePath('/')
  safeRevalidatePath('/en')
  safeRevalidatePath('/ja')
  if (!slug) return
  safeRevalidatePath(`/posts/${slug}`)
  safeRevalidatePath(`/en/posts/${slug}`)
  safeRevalidatePath(`/ja/posts/${slug}`)
}

export function revalidateCityPaths(slug: string | null | undefined) {
  safeRevalidatePath('/city')
  safeRevalidatePath('/en/city')
  if (!slug) return
  const encoded = encodeURIComponent(slug)
  safeRevalidatePath(`/city/${encoded}`)
  safeRevalidatePath(`/en/city/${encoded}`)
}

export function revalidateAnimePaths(id: string) {
  const encoded = encodeURIComponent(id)
  safeRevalidatePath('/anime')
  safeRevalidatePath('/ja/anime')
  safeRevalidatePath('/en/anime')
  safeRevalidatePath(`/anime/${encoded}`)
  safeRevalidatePath(`/ja/anime/${encoded}`)
  safeRevalidatePath(`/en/anime/${encoded}`)
}

export function revalidateMapPaths() {
  safeRevalidatePath('/map')
  safeRevalidatePath('/en/map')
  safeRevalidatePath('/ja/map')
}

export function resolveTaskSourceHash(task: {
  entityType: string
  sourceHash: string | null
  sourceContent: unknown
  draftContent: unknown
}): string | null {
  if (task.sourceHash) return task.sourceHash

  if (task.entityType === 'anitabi_bangumi') {
    const source = task.sourceContent as
      | {
          title?: string
          description?: string | null
          city?: string | null
        }
      | null
    const draft = task.draftContent as
      | {
          title?: string
          description?: string | null
          city?: string | null
        }
      | null
    return buildBangumiSourceHash({
      titleZh: source?.title || draft?.title || '',
      description: source?.description || draft?.description || null,
      city: source?.city || draft?.city || null,
    })
  }

  if (task.entityType === 'anitabi_point') {
    const source = task.sourceContent as
      | {
          name?: string
          note?: string | null
        }
      | null
    const draft = task.draftContent as
      | {
          name?: string
          note?: string | null
        }
      | null
    return buildPointSourceHash({
      name: source?.name || draft?.name || '',
      nameZh: source?.name || draft?.name || '',
      mark: source?.note || draft?.note || null,
    })
  }

  return null
}
