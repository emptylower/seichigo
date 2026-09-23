import type { ItemRecord } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'

export type ApiFail = { ok: false; status: number; error: string; reason?: string }
export type ApiResult<T> = { ok: true; data: T } | ApiFail

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function apiFetch<T>(url: string, init?: RequestInit, locale: SupportedLocale = 'zh'): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof data.error === 'string' ? data.error : tr('routebook.common.requestFailed', locale),
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, status: 0, error: tr('routebook.common.networkError', locale) }
  }
}

export function stripBookUpdatedAt<T extends { bookUpdatedAt?: string }>(row: T): Omit<T, 'bookUpdatedAt'> {
  const { bookUpdatedAt: _ignored, ...rest } = row
  return rest
}

export function sortedDayIds(items: ItemRecord[], dayId: string | null): string[] {
  return items
    .filter((row) => row.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((row) => row.id)
}
