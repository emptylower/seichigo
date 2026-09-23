import type { ItemRecord } from '../types'

export type ApiFail = { ok: false; status: number; error: string; reason?: string }
export type ApiResult<T> = { ok: true; data: T } | ApiFail

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init)
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof data.error === 'string' ? data.error : '请求失败',
        reason: typeof data.reason === 'string' ? data.reason : undefined,
      }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, status: 0, error: '网络错误，请稍后重试' }
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
