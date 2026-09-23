'use client'

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PlaceKind, RouteBookDetail } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { CreateItemInput, LodgingInput, PlaceInput, UpdateItemInput } from '../hooks/tripDataTypes'
import { dayLabel } from '../utils'
import { PlaceEditorDialog } from './PlaceEditorDialog'
import { LodgingDialog } from './LodgingDialog'
import { NoteEditorDialog } from './NoteEditorDialog'

type PlaceDialogState = {
  type: 'place'
  placeId: string | null
  presetKind?: PlaceKind
  initialCoords: { lat: number; lng: number } | null
  /** 从住宿弹窗跳来新建：建好后自动回到住宿弹窗并预选新点 */
  returnToLodging: boolean
}

type LodgingDialogState = {
  type: 'lodging'
  lodgingId: string | null
  presetDayIndex: number | null
  presetPlaceId: string | null
}

type DialogState = PlaceDialogState | LodgingDialogState | { type: 'note'; dayId: string }

export type DialogsHostApi = {
  host: ReactNode
  openPlaceEditor: (opts?: { placeId?: string; presetKind?: PlaceKind; initialCoords?: { lat: number; lng: number } }) => void
  openLodgingEditor: (opts?: { lodgingId?: string; presetDayIndex?: number; presetPlaceId?: string }) => void
  openNoteEditor: (dayId: string) => void
}

/** 弹窗编排：自定义点 / 住宿（备注、天顺序在各自批次里挂进来） */
export function useDialogsHost({
  detail,
  createPlace,
  updatePlace,
  createLodging,
  updateLodging,
  addItem,
  updateItem,
  locale = 'zh',
}: {
  detail: RouteBookDetail | null
  createPlace: (input: PlaceInput) => Promise<string | null>
  updatePlace: (placeId: string, input: Partial<PlaceInput>) => Promise<boolean>
  createLodging: (input: LodgingInput) => Promise<string | null>
  updateLodging: (lodgingId: string, input: Partial<LodgingInput>) => Promise<boolean>
  addItem: (dayId: string | null, input: CreateItemInput) => Promise<string | null>
  updateItem: (itemId: string, data: UpdateItemInput) => Promise<boolean>
  locale?: SupportedLocale
}): DialogsHostApi {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const returnPlaceIdRef = useRef<string | null>(null)

  const close = useCallback(() => setDialog(null), [])

  const openPlaceEditor = useCallback<DialogsHostApi['openPlaceEditor']>((opts) => {
    setDialog({
      type: 'place',
      placeId: opts?.placeId ?? null,
      presetKind: opts?.presetKind,
      initialCoords: opts?.initialCoords ?? null,
      returnToLodging: false,
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

  const openNoteEditor = useCallback<DialogsHostApi['openNoteEditor']>((dayId) => {
    setDialog({ type: 'note', dayId })
  }, [])

  // 住宿 → 新建住宿点 → 回到住宿：PlaceEditorDialog 提交成功后会调 onClose，
  // 这里借 onClose 把新建的 placeId 带回住宿弹窗（直接取消则正常关闭）
  const closePlaceDialog = useCallback(() => {
    const presetPlaceId = returnPlaceIdRef.current
    returnPlaceIdRef.current = null
    if (presetPlaceId) {
      setDialog({ type: 'lodging', lodgingId: null, presetDayIndex: null, presetPlaceId })
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
          locale={locale}
          onClose={dialog.returnToLodging ? closePlaceDialog : close}
          onSubmit={async (input) => {
            if (place) return updatePlace(place.id, input)
            const newId = await createPlace(input)
            if (newId && dialog.returnToLodging) returnPlaceIdRef.current = newId
            return Boolean(newId)
          }}
        />
      )
    }

    if (dialog.type === 'note') {
      const day = detail.days.find((row) => row.id === dialog.dayId) ?? null
      return (
        <NoteEditorDialog
          open
          dayLabelText={day ? dayLabel(day, day.dayIndex, locale) : undefined}
          locale={locale}
          onClose={close}
          onSubmit={async (input) => {
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
        onRequestNewPlace={() =>
          setDialog({ type: 'place', placeId: null, presetKind: 'lodging', initialCoords: null, returnToLodging: true })
        }
        onSubmit={async (input) => {
          if (lodging) return updateLodging(lodging.id, input)
          return Boolean(await createLodging(input))
        }}
      />
    )
  }, [detail, dialog, locale, close, closePlaceDialog, createPlace, updatePlace, createLodging, updateLodging, addItem, updateItem])

  return { host, openPlaceEditor, openLodgingEditor, openNoteEditor }
}
