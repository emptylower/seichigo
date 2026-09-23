'use client'

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ItemRecord, PlaceKind, RouteBookDetail } from '../types'
import { DAY_ITEM_LIMIT } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { CreateItemInput, LodgingInput, PlaceInput, UpdateItemInput } from '../hooks/tripDataTypes'
import { dayLabel } from '../utils'
import { PlaceEditorDialog } from './PlaceEditorDialog'
import { LodgingDialog } from './LodgingDialog'
import { NoteEditorDialog } from './NoteEditorDialog'
import { DayOrderDialog } from './DayOrderDialog'

function dayPointCount(items: ItemRecord[], dayId: string): number {
  return items.filter((row) => row.dayId === dayId && (row.kind === 'point' || row.kind === 'place')).length
}

type PlaceDialogState = {
  type: 'place'
  placeId: string | null
  presetKind?: PlaceKind
  initialCoords: { lat: number; lng: number } | null
  /** 从住宿弹窗跳来新建：建好后自动回到住宿弹窗并预选新点 */
  returnToLodging: boolean
  /** 新建成功后自动加一条 place 条目的目标天（null = 未安排） */
  targetDayId: string | null
}

type LodgingDialogState = {
  type: 'lodging'
  lodgingId: string | null
  presetDayIndex: number | null
  presetPlaceId: string | null
}

type DialogState =
  | PlaceDialogState
  | LodgingDialogState
  | { type: 'note'; dayId: string | null; itemId?: string }
  | { type: 'dayOrder' }

export type DialogsHostApi = {
  host: ReactNode
  /** 新建时 targetDayId 为保存后自动加入的天（缺省 / null = 未安排）；编辑模式忽略 */
  openPlaceEditor: (opts?: {
    placeId?: string
    presetKind?: PlaceKind
    initialCoords?: { lat: number; lng: number }
    targetDayId?: string | null
  }) => void
  openLodgingEditor: (opts?: { lodgingId?: string; presetDayIndex?: number; presetPlaceId?: string }) => void
  /** 新建备注：传 dayId；编辑备注：再传 itemId（dayId 仅用于标题栏展示） */
  openNoteEditor: (dayId: string | null, itemId?: string) => void
  openDayOrder: () => void
}

/** 弹窗编排：自定义点 / 住宿（备注、天顺序在各自批次里挂进来） */
export function useDialogsHost({
  detail,
  createPlace,
  updatePlace,
  createLodging,
  updateLodging,
  deleteLodging,
  addItem,
  updateItem,
  insertDay,
  deleteDay,
  reorderDays,
  searchNear = null,
  locale = 'zh',
}: {
  detail: RouteBookDetail | null
  createPlace: (input: PlaceInput) => Promise<string | null>
  updatePlace: (placeId: string, input: Partial<PlaceInput>) => Promise<boolean>
  createLodging: (input: LodgingInput) => Promise<string | null>
  updateLodging: (lodgingId: string, input: Partial<LodgingInput>) => Promise<boolean>
  deleteLodging: (lodgingId: string) => Promise<boolean>
  addItem: (dayId: string | null, input: CreateItemInput) => Promise<string | null>
  updateItem: (itemId: string, data: UpdateItemInput) => Promise<boolean>
  insertDay: (afterDayIndex: number) => Promise<string | null>
  deleteDay: (dayId: string) => Promise<boolean>
  reorderDays: (orderedDayIds: string[]) => Promise<boolean>
  /** 地址搜索的 near：行程几何中心 */
  searchNear?: { lat: number; lng: number } | null
  locale?: SupportedLocale
}): DialogsHostApi {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const returnPlaceIdRef = useRef<string | null>(null)
  /** 从住宿弹窗跳去新建住宿点时，记住当时的预选入住日，回来不丢 */
  const returnPresetDayIndexRef = useRef<number | null>(null)

  const close = useCallback(() => setDialog(null), [])

  const openPlaceEditor = useCallback<DialogsHostApi['openPlaceEditor']>((opts) => {
    setDialog({
      type: 'place',
      placeId: opts?.placeId ?? null,
      presetKind: opts?.presetKind,
      initialCoords: opts?.initialCoords ?? null,
      returnToLodging: false,
      targetDayId: opts?.targetDayId ?? null,
    })
  }, [])

  const openLodgingEditor = useCallback<DialogsHostApi['openLodgingEditor']>((opts) => {
    setDialog({
      type: 'lodging',
      lodgingId: opts?.lodgingId ?? null,
      presetDayIndex: opts?.presetDayIndex ?? null,
      presetPlaceId: opts?.presetPlaceId ?? null,
    })
  }, [])

  const openNoteEditor = useCallback<DialogsHostApi['openNoteEditor']>((dayId, itemId) => {
    setDialog({ type: 'note', dayId, itemId })
  }, [])

  const openDayOrder = useCallback<DialogsHostApi['openDayOrder']>(() => {
    setDialog({ type: 'dayOrder' })
  }, [])

  // 住宿 → 新建住宿点 → 回到住宿：PlaceEditorDialog 提交成功后会调 onClose，
  // 这里借 onClose 把新建的 placeId 与当时的预选入住日带回住宿弹窗（直接取消则正常关闭）
  const closePlaceDialog = useCallback(() => {
    const presetPlaceId = returnPlaceIdRef.current
    const presetDayIndex = returnPresetDayIndexRef.current
    returnPlaceIdRef.current = null
    returnPresetDayIndexRef.current = null
    if (presetPlaceId) {
      setDialog({ type: 'lodging', lodgingId: null, presetDayIndex, presetPlaceId })
    } else {
      setDialog(null)
    }
  }, [])

  const host = useMemo<ReactNode>(() => {
    if (!detail || !dialog) return null

    if (dialog.type === 'place') {
      const place = dialog.placeId ? detail.places.find((row) => row.id === dialog.placeId) ?? null : null
      if (dialog.placeId && !place) return null
      return (
        <PlaceEditorDialog
          open
          place={place}
          presetKind={dialog.presetKind}
          initialCoords={dialog.initialCoords}
          searchNear={searchNear}
          locale={locale}
          onClose={dialog.returnToLodging ? closePlaceDialog : close}
          onSubmit={async (input) => {
            if (place) return updatePlace(place.id, input)
            const newId = await createPlace(input)
            if (!newId) return false
            if (dialog.returnToLodging) {
              // 住宿流程：新点交给住宿弹窗预选，不另建条目
              returnPlaceIdRef.current = newId
              return true
            }
            // 新建即上地图：加到目标天末尾（该天点位已满 → 未安排）；条目失败由 addItem 自行 toast，点已建成
            const targetDayId =
              dialog.targetDayId && dayPointCount(detail.items, dialog.targetDayId) < DAY_ITEM_LIMIT ? dialog.targetDayId : null
            await addItem(targetDayId, { kind: 'place', placeId: newId })
            return true
          }}
        />
      )
    }

    if (dialog.type === 'note') {
      const day = dialog.dayId ? detail.days.find((row) => row.id === dialog.dayId) ?? null : null
      const editingItem = dialog.itemId
        ? (detail.items.find((row) => row.id === dialog.itemId && row.kind === 'note') ?? null)
        : null
      if (dialog.itemId && !editingItem) return null
      return (
        <NoteEditorDialog
          open
          item={editingItem}
          dayLabelText={day ? dayLabel(day, day.dayIndex, locale) : undefined}
          locale={locale}
          onClose={close}
          onSubmit={async (input) => {
            // 编辑模式：一条 PATCH 更新标题/详情/图标/颜色/时间
            if (editingItem) {
              return updateItem(editingItem.id, {
                title: input.title,
                note: input.note,
                icon: input.icon,
                color: input.color,
                timeStart: input.timeStart,
              })
            }
            if (!dialog.dayId) return false
            // createItemSchema 不收 icon/color：先建条目再 PATCH 图标与颜色
            const newId = await addItem(dialog.dayId, {
              kind: 'note',
              title: input.title,
              note: input.note ?? undefined,
              timeStart: input.timeStart ?? undefined,
            })
            if (!newId) return false
            if (input.icon !== 'info' || input.color !== 'gray') {
              return updateItem(newId, { icon: input.icon, color: input.color })
            }
            return true
          }}
        />
      )
    }

    if (dialog.type === 'dayOrder') {
      const itemCountByDay: Record<string, number> = {}
      for (const item of detail.items) {
        if (!item.dayId) continue
        itemCountByDay[item.dayId] = (itemCountByDay[item.dayId] ?? 0) + 1
      }
      return (
        <DayOrderDialog
          open
          days={detail.days}
          itemCountByDay={itemCountByDay}
          locale={locale}
          onClose={close}
          onSubmit={(orderedDayIds) => reorderDays(orderedDayIds)}
          onInsertDay={(afterVisualIndex) => insertDay(afterVisualIndex)}
          onDeleteDay={(dayId) => void deleteDay(dayId)}
        />
      )
    }

    const lodging = dialog.lodgingId ? detail.lodgings.find((row) => row.id === dialog.lodgingId) ?? null : null
    if (dialog.lodgingId && !lodging) return null
    return (
      <LodgingDialog
        open
        detail={detail}
        lodging={lodging}
        presetPlaceId={dialog.presetPlaceId}
        presetDayIndex={dialog.presetDayIndex}
        locale={locale}
        onClose={close}
        onRequestNewPlace={() => {
          returnPresetDayIndexRef.current = dialog.presetDayIndex
          setDialog({
            type: 'place',
            placeId: null,
            presetKind: 'lodging',
            initialCoords: null,
            returnToLodging: true,
            targetDayId: null,
          })
        }}
        onDelete={
          lodging
            ? async () => {
                const ok = await deleteLodging(lodging.id)
                if (ok) close()
                return ok
              }
            : undefined
        }
        onSubmit={async (input) => {
          if (lodging) return updateLodging(lodging.id, input)
          return Boolean(await createLodging(input))
        }}
      />
    )
  }, [detail, dialog, locale, close, closePlaceDialog, createPlace, updatePlace, createLodging, updateLodging, deleteLodging, addItem, updateItem, insertDay, deleteDay, reorderDays, searchNear])

  return { host, openPlaceEditor, openLodgingEditor, openNoteEditor, openDayOrder }
}
