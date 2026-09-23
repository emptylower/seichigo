'use client'

import { useCallback } from 'react'
import type { LodgingRecord, PlaceRecord } from '../types'
import { JSON_HEADERS, stripBookUpdatedAt } from './tripDataApi'
import { useMutationBase, type MutationDeps } from './useMutationBase'
import { tr } from '../../i18n'
import type { LodgingInput, PlaceInput } from './tripDataTypes'

/** 自定义点与住宿写操作：create/update/delete × Place/Lodging */
export function usePlaceLodgingMutations({
  id,
  detailRef,
  setDetail,
  handleFailure,
  locale = 'zh',
}: MutationDeps) {
  const { api, applyBookUpdatedAt, localeRef } = useMutationBase({ setDetail, locale })

  const createPlace = useCallback(
    async (input: PlaceInput): Promise<string | null> => {
      const result = await api<{ place?: PlaceRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.place) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, null, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }
      const place = stripBookUpdatedAt(result.data.place)
      setDetail((cur) => (cur ? { ...cur, places: [...cur.places, place] } : cur))
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.place.bookUpdatedAt
      )
      return place.id
    },
    [api, applyBookUpdatedAt, handleFailure, id, localeRef, setDetail]
  )

  const updatePlace = useCallback(
    async (placeId: string, input: Partial<PlaceInput>): Promise<boolean> => {
      const result = await api<{ place?: PlaceRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places/${placeId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const place = result.data.place ? stripBookUpdatedAt(result.data.place) : null
      if (place) {
        setDetail((cur) =>
          cur ? { ...cur, places: cur.places.map((row) => (row.id === placeId ? place : row)) } : cur
        )
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.place?.bookUpdatedAt
      )
      return true
    },
    [api, applyBookUpdatedAt, handleFailure, id, localeRef, setDetail]
  )

  const deletePlace = useCallback(
    async (placeId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({
        ...prev,
        places: prev.places.filter((row) => row.id !== placeId),
        items: prev.items.filter((row) => row.placeId !== placeId),
        lodgings: prev.lodgings.filter((row) => row.placeId !== placeId),
      })
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/places/${placeId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      return true
    },
    [api, applyBookUpdatedAt, detailRef, handleFailure, id, localeRef, setDetail]
  )

  const createLodging = useCallback(
    async (input: LodgingInput): Promise<string | null> => {
      const result = await api<{ lodging?: LodgingRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings`,
        { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok || !result.data.lodging) {
        handleFailure(result.ok === false ? result : { ok: false, status: 500, error: tr('routebook.detail.addFailed', localeRef.current) }, null, tr('routebook.detail.addFailed', localeRef.current))
        return null
      }
      const lodging = stripBookUpdatedAt(result.data.lodging)
      setDetail((cur) => (cur ? { ...cur, lodgings: [...cur.lodgings, lodging] } : cur))
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.lodging.bookUpdatedAt
      )
      return lodging.id
    },
    [api, applyBookUpdatedAt, handleFailure, id, localeRef, setDetail]
  )

  const updateLodging = useCallback(
    async (lodgingId: string, input: Partial<LodgingInput>): Promise<boolean> => {
      const result = await api<{ lodging?: LodgingRecord & { bookUpdatedAt?: string }; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings/${lodgingId}`,
        { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(input) }
      )
      if (!result.ok) {
        handleFailure(result, null, tr('routebook.detail.saveFailed', localeRef.current))
        return false
      }
      const lodging = result.data.lodging ? stripBookUpdatedAt(result.data.lodging) : null
      if (lodging) {
        setDetail((cur) =>
          cur ? { ...cur, lodgings: cur.lodgings.map((row) => (row.id === lodgingId ? lodging : row)) } : cur
        )
      }
      applyBookUpdatedAt(
        typeof result.data.bookUpdatedAt === 'string' ? result.data.bookUpdatedAt : result.data.lodging?.bookUpdatedAt
      )
      return true
    },
    [api, applyBookUpdatedAt, handleFailure, id, localeRef, setDetail]
  )

  const deleteLodging = useCallback(
    async (lodgingId: string): Promise<boolean> => {
      const prev = detailRef.current
      if (!prev) return false
      setDetail({ ...prev, lodgings: prev.lodgings.filter((row) => row.id !== lodgingId) })
      const result = await api<{ ok?: boolean; bookUpdatedAt?: string }>(
        `/api/me/routebooks/${id}/lodgings/${lodgingId}`,
        {
          method: 'DELETE',
        }
      )
      if (!result.ok) {
        handleFailure(result, prev, tr('routebook.detail.deleteFailed', localeRef.current))
        return false
      }
      applyBookUpdatedAt(result.data.bookUpdatedAt)
      return true
    },
    [api, applyBookUpdatedAt, detailRef, handleFailure, id, localeRef, setDetail]
  )

  return {
    createPlace,
    updatePlace,
    deletePlace,
    createLodging,
    updateLodging,
    deleteLodging,
  }
}
