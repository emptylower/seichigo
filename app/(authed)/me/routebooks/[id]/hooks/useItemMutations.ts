'use client'

import { useCallback } from 'react'
import type { ItemRecord } from '../types'
import { applyReorderLocal } from '../utils'
import { JSON_HEADERS, sortedDayIds, stripBookUpdatedAt } from './tripDataApi'
import { refreshPointPoolSilently, useMutationBase, type MutationDeps } from './useMutationBase'
import { tr } from '../../i18n'
import type { CreateItemInput, UpdateItemInput } from './tripDataTypes'

/** 条目写操作：addItem/updateItem/deleteItem/reorder/optimizeDay（乐观更新 + 失败回滚 + 撤销环入栈） */
export function useItemMutations({
  id,
  detailRef,
  setDetail,
  handleFailure,
  pushUndo,
  refreshPointPool,
  showToast,
  locale = 'zh',
}: MutationDeps) {
  const { api, applyBookUpdatedAt, localeRef } = useMutationBase({ setDetail, locale })

  const deleteItemInner = useCallback(
    async (itemId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, items: prev.items.filter((row) => row.id !== itemId) })
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/items/${itemId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      void refreshPointPool()
      return true
    },
    [api, applyBookUpdatedAt, detailRef, handleFailure, id, localeRef, refreshPointPool, setDetail]
  )

  const addItem = useCallback(
    async (dayId: string | null, input: CreateItemInput, index?: number): Promise<string | null> => {
      const prev = detailRef.current
      if (!prev) return null

      const tempId = `temp-${crypto.randomUUID()}`
      const siblings = prev.items.filter((row) => row.dayId === dayId)
      const insertAt = index ?? siblings.length
      const tempItem: ItemRecord = {
        id: tempId,
        routeBookId: prev.id,
        dayId,
        sortOrder: insertAt,
        kind: input.kind,
        pointId: input.pointId ?? null,
        placeId: input.placeId ?? null,
        title: input.title ?? null,
        note: input.note ?? null,
        timeStart: input.timeStart ?? null,
        timeEnd: null,
        locked: false,
        icon: null,
        color: null,
        legMode: null,
        payload: null,
        createdAt: new Date().toISOString(),
      }
      // 插入位置之后的同天兄弟本地顺移 sortOrder，保持乐观顺序与服务端重编一致
      const optimistic = prev.items.map((row) =>
        row.dayId === dayId && row.sortOrder >= insertAt ? { ...row, sortOrder: row.sortOrder + 1 } : row
      )
      setDetail({ ...prev, items: [...optimistic, tempItem] })

      const result = await api<{
        item?: ItemRecord & { bookUpdatedAt?: string }
        items?: ItemRecord[]
        bookUpdatedAt?: string
      }>(`/api/me/routebooks/${id}/items`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ dayId, ...input, index }),
      })
      if (!result.ok || !result.data.item) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, prev, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }

      const created = result.data.item
      const item = stripBookUpdatedAt(created)
      const serverDayItems = Array.isArray(result.data.items) ? result.data.items : null
      const bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : created.bookUpdatedAt
      // 服务端对同天同点位幂等：返回的是本地已有的条目（快速重复加入同一点）→ 不是新建，不入撤销栈，
      // 否则连续撤销两次会对同一条目 DELETE 两次（冒烟 01:14:43 的 400）
      const alreadyPresent = detailRef.current?.items.some((row) => row.id === item.id) ?? false
      setDetail((cur) => {
        if (!cur) return cur
        const updatedAt = bookUpdatedAt ?? cur.updatedAt
        // 契约：items 为目标天写入后的完整条目（已重编 sortOrder），整体替换该天
        if (serverDayItems) {
          const others = cur.items.filter((row) => row.dayId !== dayId)
          return { ...cur, items: [...others, ...serverDayItems], updatedAt }
        }
        // 服务端对同天同点位幂等（返回已有条目）：此时删掉临时条目即可
        const exists = cur.items.some((row) => row.id === item.id)
        const items = exists
          ? cur.items.filter((row) => row.id !== tempId)
          : cur.items.map((row) => (row.id === tempId ? item : row))
        return { ...cur, items, updatedAt }
      })
      if (input.kind === 'point' && input.pointId) {
        refreshPointPoolSilently(refreshPointPool)
      }
      const createdId = item.id
      if (alreadyPresent) return createdId
      pushUndo({
        label: tr('routebook.detail.undoAddItem', localeRef.current),
        revert: async () => {
          await deleteItemInner(createdId)
        },
      })
      return item.id
    },
    [api, deleteItemInner, detailRef, handleFailure, id, localeRef, pushUndo, refreshPointPool, setDetail]
  )

  const updateItem = useCallback(
    async (itemId: string, data: UpdateItemInput): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const optimistic = prev.items.map((row) => {
        if (row.id !== itemId) return row
        const next = { ...row }
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) {
            ;(next as Record<string, unknown>)[key] = value
          }
        }
        return next
      })
      setDetail({ ...prev, items: optimistic })

      const result = await api<{ item?: ItemRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/items/${itemId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(data) }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const updated = result.data.item
      const bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : updated?.bookUpdatedAt
      if (updated) {
        const item = stripBookUpdatedAt(updated)
        setDetail((cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((row) => (row.id === itemId ? item : row)),
                updatedAt: bookUpdatedAt ?? cur.updatedAt,
              }
            : cur
        )
      } else {
        applyBookUpdatedAt(bookUpdatedAt)
      }
      return true
    },
    [api, applyBookUpdatedAt, detailRef, handleFailure, id, localeRef, setDetail]
  )

  const recreateItem = useCallback(
    async (target: ItemRecord): Promise<void> => {
      // createItemSchema 只接收部分字段（payload 由服务端管，不传）；
      // locked/timeEnd/icon/color/legMode 建后补 PATCH 还原，避免撤销丢字段
      const result = await api<{
        item?: ItemRecord & { bookUpdatedAt?: string }
        items?: ItemRecord[]
        bookUpdatedAt?: string
      }>(`/api/me/routebooks/${id}/items`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          dayId: target.dayId,
          kind: target.kind,
          pointId: target.pointId ?? undefined,
          placeId: target.placeId ?? undefined,
          title: target.title ?? undefined,
          note: target.note ?? undefined,
          timeStart: target.timeStart ?? undefined,
          index: target.sortOrder,
        }),
      })
      if (!result.ok || !result.data.item) {
        showToast(result.ok === false ? result.error : tr('routebook.detail.restoreFailed', localeRef.current))
        return
      }
      const created = result.data.item
      let item = stripBookUpdatedAt(created)
      let bookUpdatedAt =
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : created.bookUpdatedAt

      const patch: UpdateItemInput = {}
      if (target.timeEnd) patch.timeEnd = target.timeEnd
      if (target.locked) patch.locked = true
      if (target.icon) patch.icon = target.icon
      if (target.color) patch.color = target.color
      if (target.legMode) patch.legMode = target.legMode
      if (Object.keys(patch).length > 0) {
        const patchResult = await api<{ item?: ItemRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
          `/api/me/routebooks/${id}/items/${item.id}`,
          { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) }
        )
        if (patchResult.ok && patchResult.data.item) {
          item = stripBookUpdatedAt(patchResult.data.item)
          bookUpdatedAt =
            typeof patchResult.data.bookUpdatedAt === 'string'
              ? patchResult.data.bookUpdatedAt
              : (patchResult.data.item.bookUpdatedAt ?? bookUpdatedAt)
        }
      }

      const serverDayItems = Array.isArray(result.data.items) ? result.data.items : null
      const finalItem = item
      const finalUpdatedAt = bookUpdatedAt
      setDetail((cur) => {
        if (!cur || cur.items.some((row) => row.id === finalItem.id)) return cur
        const updatedAt = finalUpdatedAt ?? cur.updatedAt
        if (serverDayItems) {
          const others = cur.items.filter((row) => row.dayId !== target.dayId)
          const dayItems = serverDayItems.map((row) => (row.id === finalItem.id ? finalItem : row))
          return { ...cur, items: [...others, ...dayItems], updatedAt }
        }
        return { ...cur, items: [...cur.items, finalItem], updatedAt }
      })
    },
    [api, id, localeRef, setDetail, showToast]
  )

  const deleteItem = useCallback(
    async (itemId: string): Promise<boolean> => {
      const target = detailRef.current?.items.find((row) => row.id === itemId)
      const ok = await deleteItemInner(itemId)
      if (ok && target) {
        pushUndo({
          label: tr('routebook.detail.undoDeleteItem', localeRef.current),
          revert: async () => {
            await recreateItem(target)
          },
        })
      }
      return ok
    },
    [deleteItemInner, detailRef, localeRef, pushUndo, recreateItem]
  )

  type ReorderResult = { ok: boolean; items: ItemRecord[] | null }

  const reorderInner = useCallback(
    async (targetDayId: string | null, orderedItemIds: string[]): Promise<ReorderResult> => {
      const prev = detailRef.current
      if (!prev) return { ok: false, items: null }
      setDetail({ ...prev, items: applyReorderLocal(prev.items, targetDayId, orderedItemIds) })
      const result = await api<{ items?: ItemRecord[]; bookUpdatedAt?: string; updatedAt?: string }>(
        `/api/me/routebooks/${id}/items/reorder`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ dayId: targetDayId, orderedItemIds }),
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.reorderFailed', localeRef.current))
        return { ok: false, items: null }
      }
      const data = result.data
      const nextUpdatedAt =
        typeof data.bookUpdatedAt === 'string'
          ? data.bookUpdatedAt
          : typeof data.updatedAt === 'string'
            ? data.updatedAt
            : undefined
      const serverItems = Array.isArray(data.items) ? data.items : null
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: serverItems ?? cur.items,
              updatedAt: nextUpdatedAt ?? cur.updatedAt,
            }
          : cur
      )
      return { ok: true, items: serverItems }
    },
    [api, detailRef, handleFailure, id, localeRef, setDetail]
  )

  const reorder = useCallback(
    async (targetDayId: string | null, orderedItemIds: string[]): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const byId = new Map(prev.items.map((row) => [row.id, row]))
      const movedIn = orderedItemIds.filter((itemId) => {
        const found = byId.get(itemId)
        return found && found.dayId !== targetDayId
      })
      const sourceDays = new Set(movedIn.map((itemId) => byId.get(itemId)!.dayId))
      const prevTarget = sortedDayIds(prev.items, targetDayId)
      const prevSources = new Map([...sourceDays].map((dayId) => [dayId, sortedDayIds(prev.items, dayId)]))

      const res = await reorderInner(targetDayId, orderedItemIds)
      if (res.ok) {
        // 服务端可能在 reorder 时增删 transit：撤销以响应 items（整本）为准重建 id 列表，
        // 拖拽前的旧列表可能含已被服务端删掉的条目
        const serverIds = res.items ? new Set(res.items.map((row) => row.id)) : null
        const alive = (ids: string[]) => (serverIds ? ids.filter((itemId) => serverIds.has(itemId)) : ids)
        pushUndo({
          label: tr('routebook.detail.undoReorder', localeRef.current),
          revert: async () => {
            // 跨天移动：先把移入条目拉回源天，再恢复目标天内部顺序
            for (const [dayId, ids] of prevSources) {
              await reorderInner(dayId, alive(ids))
            }
            await reorderInner(targetDayId, alive(prevTarget))
          },
        })
      }
      return res.ok
    },
    [detailRef, localeRef, pushUndo, reorderInner]
  )

  const optimizeDay = useCallback(
    async (dayId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      const beforeIds = sortedDayIds(prev.items, dayId)
      const result = await api<{
        items?: ItemRecord[]
        bookUpdatedAt?: string
        updatedAt?: string
        distanceBeforeM?: number
        distanceAfterM?: number
      }>(`/api/me/routebooks/${id}/days/${dayId}/optimize`, { method: 'POST' })
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.optimizeFailed', localeRef.current))
        return false
      }
      const data = result.data
      const nextUpdatedAt =
        typeof data.bookUpdatedAt === 'string'
          ? data.bookUpdatedAt
          : typeof data.updatedAt === 'string'
            ? data.updatedAt
            : undefined
      setDetail((cur) =>
        cur
          ? {
              ...cur,
              items: Array.isArray(data.items) ? data.items : cur.items,
              updatedAt: nextUpdatedAt ?? cur.updatedAt,
            }
          : cur
      )
      pushUndo({
        label: tr('routebook.detail.undoOptimize', localeRef.current),
        revert: async () => {
          await reorderInner(dayId, beforeIds)
        },
      })
      const saved =
        typeof data.distanceBeforeM === 'number' && typeof data.distanceAfterM === 'number'
          ? Math.max(0, Math.round((data.distanceBeforeM - data.distanceAfterM) / 100) / 10)
          : 0
      showToast(saved > 0 ? tr('routebook.detail.optimizeSaved', localeRef.current, { km: saved }) : tr('routebook.detail.optimizeDone', localeRef.current))
      return true
    },
    [api, detailRef, handleFailure, id, localeRef, pushUndo, reorderInner, setDetail, showToast]
  )

  return {
    addItem,
    updateItem,
    deleteItem,
    reorder,
    optimizeDay,
  }
}
