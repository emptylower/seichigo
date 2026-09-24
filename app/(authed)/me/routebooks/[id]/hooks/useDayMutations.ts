'use client'

import { useCallback } from 'react'
import type { DayRecord, RouteBookDetail, RouteBookStatus, TravelMode } from '../types'
import { JSON_HEADERS, stripBookUpdatedAt } from './tripDataApi'
import { useMutationBase, type MutationDeps } from './useMutationBase'
import { applyDayDeleteLocal, applyDayInsertLocal, computeDayDateIso } from '../utils'
import { tr } from '../../i18n'
import type { PatchBookInput } from './tripDataTypes'

/** 行程本与天级写操作：patchBook/insertDay/updateDay/deleteDay/reorderDays */
export function useDayMutations({
  id,
  detailRef,
  setDetail,
  handleFailure,
  load,
  locale = 'zh',
}: MutationDeps) {
  const { api, applyBookUpdatedAt, localeRef } = useMutationBase({ setDetail, locale })

  const patchBook = useCallback(
    async (input: PatchBookInput): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        title: input.title ?? prev.title,
        status: input.status ?? prev.status,
        startDate: input.startDate !== undefined ? input.startDate : prev.startDate,
        dayCount: input.dayCount ?? prev.dayCount,
      })
      const result = await api<{ routeBook?: Partial<RouteBookDetail>; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ ...input, updatedAt: prev.updatedAt }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      if (input.dayCount !== undefined) {
        // 服务端会补建天，整份重拉
        await load()
        return true
      }
      const updated = result.data.routeBook
      const bookUpdatedAt = result.data.bookUpdatedAt
      if (input.startDate !== undefined) {
        // 只改开始日期：服务端按 computeDayDate（start + (dayIndex-1) 天）重算各天 date；
        // PATCH 响应不带 days，本地按同一规则更新，避免整页重拉（骨架闪烁 + 清空撤销栈）
        const startDate = typeof updated?.startDate === 'string' ? updated.startDate : input.startDate
        setDetail((cur) =>
          cur
            ? {
                ...cur,
                startDate,
                days: cur.days.map((day) => ({ ...day, date: computeDayDateIso(startDate, day.dayIndex) })),
                updatedAt: typeof bookUpdatedAt === 'string' ? bookUpdatedAt : cur.updatedAt,
              }
            : cur
        )
        return true
      }
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              title: typeof updated?.title === 'string' ? updated.title : cur.title,
              status: (updated?.status as RouteBookStatus | undefined) ?? cur.status,
              updatedAt:
                typeof bookUpdatedAt === 'string'
                  ? bookUpdatedAt
                  : typeof updated?.updatedAt === 'string'
                    ? updated.updatedAt
                    : cur.updatedAt,
            }
          : cur
      )
      return true
    },
    [api, detailRef, handleFailure, id, load, localeRef, setDetail]
  )

  const insertDay = useCallback(
    async (afterDayIndex: number): Promise<string | null> => {
      const result = await api<{ day?: DayRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/days`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ afterDayIndex }) }
      )
      if (!result.ok || !result.data.day) {
        handleFailure(
          result.ok === false
            ? result
            : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) },
          null,
          tr('routebook.detail.addFailed', localeRef.current)
        )
        return null
      }
      const day = stripBookUpdatedAt(result.data.day)
      const bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string'
          ? result.data.bookUpdatedAt
          : (result.data.day.bookUpdatedAt ?? null)
      // 不整页重载：按与服务端一致的重编规则本地插入（天顺序弹窗依赖弹窗不关闭）
      setDetail((cur) => (cur ? applyDayInsertLocal(cur, day, bookUpdatedAt) : cur))
      return day.id
    },
    [api, handleFailure, id, localeRef, setDetail]
  )

  const updateDay = useCallback(
    async (dayId: string, data: { title?: string | null; defaultTravelMode?: TravelMode }): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        days: prev.days.map((row) => (row.id === dayId ? { ...row, ...data } : row)),
      })
      const result = await api<{ day?: DayRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/days/${dayId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.day?.bookUpdatedAt
      )
      return true
    },
    [api, applyBookUpdatedAt, detailRef, handleFailure, id, localeRef, setDetail]
  )

  const deleteDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(`/api/me/routebooks/${id}/days/${dayId}`, {
        method: 'DELETE',
      })
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      const bookUpdatedAt = typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : null
      // 不整页重载：本地删掉该天并重编后续 dayIndex/住宿（规则与服务端一致）
      setDetail((cur) => (cur ? (applyDayDeleteLocal(cur, dayId, bookUpdatedAt) ?? cur) : cur))
      return true
    },
    [api, handleFailure, id, localeRef, setDetail]
  )

  const reorderDays = useCallback(
    async (orderedDayIds: string[]): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const byId = new Map(prev.days.map((row) => [row.id, row]))
      const optimistic = orderedDayIds
        .map((dayId, index) => {
          const found = byId.get(dayId)
          return found ? { ...found, dayIndex: index + 1 } : null
        })
        .filter((row): row is DayRecord => row !== null)
      setDetail({ ...prev, days: optimistic })
      const result = await api<{ days?: DayRecord[]; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/days/reorder`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ orderedDayIds }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.reorderFailed', localeRef.current))
        return false
      }
      const serverDays = Array.isArray(result.data.days) ? result.data.days : null
      const bookUpdatedAt = result.data.bookUpdatedAt
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              days: serverDays ?? cur.days,
              updatedAt: typeof bookUpdatedAt === 'string' ? bookUpdatedAt : cur.updatedAt,
            }
          : cur
      )
      return true
    },
    [api, detailRef, handleFailure, id, localeRef, setDetail]
  )

  return {
    patchBook,
    insertDay,
    updateDay,
    deleteDay,
    reorderDays,
  }
}
