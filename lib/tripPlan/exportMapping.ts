import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { validateExternalPlacePayload } from '@/lib/googlePlaces/places'
import { assertLodgingNoOverlap } from '@/lib/routeBook/rules'
import type { TripPlanWithDays } from '@/lib/tripPlan/repo'
import type {
  ExportDay,
  ExportItem,
  ExportLodging,
  ExportPlace,
  RouteBookExportCreateInput,
} from '@/lib/routeBook/exportStore'
import type { RouteBookStatus } from '@/lib/routeBook/repo'

export type ExportCounts = {
  days: number
  points: number
  places: number
  notes: number
  transits: number
  lodgings: number
  degradedToNote: number
}

export type BuildExportResult = { input: RouteBookExportCreateInput; counts: ExportCounts }

const EXPORTED_STATUS: RouteBookStatus = 'draft'
const HHMM_STRICT = /^([01]\d|2[0-3]):[0-5]\d$/
const TIME_HINT = /^([01]?\d|2[0-3]):([0-5]\d)/

type ExtractedPlace = { placeId: string; name: string; address: string | null; lat: number; lng: number }

function extractPlace(payload: Prisma.JsonValue | null): ExtractedPlace | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const place = (payload as Record<string, unknown>).place
  if (validateExternalPlacePayload(place) !== null) return null
  const record = place as Record<string, unknown>
  return {
    placeId: String(record.placeId),
    name: String(record.name),
    address: typeof record.address === 'string' ? record.address : null,
    lat: Number(record.lat),
    lng: Number(record.lng),
  }
}

function readSchedule(payload: Prisma.JsonValue | null): { start?: unknown; end?: unknown; confidence?: unknown } | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const schedule = (payload as Record<string, unknown>).schedule
  if (schedule === null || typeof schedule !== 'object' || Array.isArray(schedule)) return null
  return schedule as { start?: unknown; end?: unknown; confidence?: unknown }
}

function normalizeTimeHint(timeHint: string | null): string | undefined {
  if (!timeHint) return undefined
  const match = TIME_HINT.exec(timeHint)
  if (!match) return undefined
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

function resolveTime(scheduleValue: unknown, timeHint: string | null): string | undefined {
  if (typeof scheduleValue === 'string' && HHMM_STRICT.test(scheduleValue)) return scheduleValue
  return normalizeTimeHint(timeHint)
}

type PlannedEntry = {
  exportItem: ExportItem
  transitBetween?: { prevItemId: string; nextItemId: string }
  originalPayload: Prisma.JsonValue | null
}

/** 计划 → 行程本导入输入的纯映射（含降级与计数） */
export function buildExportInput(plan: TripPlanWithDays): BuildExportResult {
  const days = [...plan.days].sort((a, b) => a.dayIndex - b.dayIndex)
  const maxDayIndex = days.reduce((max, day) => Math.max(max, day.dayIndex), 1)
  const dayCount = Math.max(1, maxDayIndex)

  // days 覆盖 1..dayCount：dayIndex 断档时补空天，保证 RouteBookDay 连续
  const dayByIndex = new Map(days.map((day) => [day.dayIndex, day]))
  const exportDays: ExportDay[] = Array.from({ length: dayCount }, (_, offset) => {
    const day = dayByIndex.get(offset + 1)
    return {
      dayIndex: offset + 1,
      date: day?.date ?? null,
      title: day?.summary ? day.summary.slice(0, 60) : null,
    }
  })

  const places: ExportPlace[] = []
  const items: ExportItem[] = []
  const lodgings: ExportLodging[] = []
  let degradedToNote = 0

  // 同一 placeId 的出现天序列（合并住宿区间用）
  const lodgingOccurrences = new Map<string, { tempId: string; dayIndexes: number[] }>()

  for (const day of days) {
    const planned: PlannedEntry[] = []

    const pushNote = (item: { title: string; note?: string | null }, dayIndex: number, degraded: boolean) => {
      planned.push({
        exportItem: {
          id: randomUUID(),
          dayIndex,
          sortOrder: 0,
          kind: 'note',
          title: item.title || '备注',
          note: item.note || undefined,
        },
        originalPayload: null,
      })
      if (degraded) degradedToNote += 1
    }

    for (const item of [...day.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const schedule = readSchedule(item.payload)
      const note = [item.note, item.reason].filter(Boolean).join('\n') || undefined

      if (item.type === 'point') {
        if (!item.pointId) continue
        planned.push({
          exportItem: {
            id: randomUUID(),
            dayIndex: day.dayIndex,
            sortOrder: 0,
            kind: 'point',
            pointId: item.pointId,
            note,
            timeStart: resolveTime(schedule?.start, item.timeHint),
            timeEnd: resolveTime(schedule?.end, null),
            locked: schedule?.confidence === 'explicit',
          },
          originalPayload: item.payload,
        })
        continue
      }

      if (item.type === 'meal' || item.type === 'attraction') {
        const place = extractPlace(item.payload)
        if (place) {
          const tempId = randomUUID()
          places.push({
            tempId,
            kind: item.type === 'meal' ? 'restaurant' : 'other',
            title: place.name,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
          })
          planned.push({
            exportItem: {
              id: randomUUID(),
              dayIndex: day.dayIndex,
              sortOrder: 0,
              kind: 'place',
              placeTempId: tempId,
              note,
              timeStart: resolveTime(schedule?.start, item.timeHint),
              timeEnd: resolveTime(schedule?.end, null),
              locked: schedule?.confidence === 'explicit',
            },
            originalPayload: item.payload,
          })
        } else {
          pushNote({ title: item.title, note }, day.dayIndex, true)
        }
        continue
      }

      if (item.type === 'lodging') {
        const place = extractPlace(item.payload)
        if (place) {
          const existing = lodgingOccurrences.get(place.placeId)
          if (existing) existing.dayIndexes.push(day.dayIndex)
          else {
            const tempId = randomUUID()
            places.push({ tempId, kind: 'lodging', title: place.name, address: place.address, lat: place.lat, lng: place.lng })
            lodgingOccurrences.set(place.placeId, { tempId, dayIndexes: [day.dayIndex] })
          }
        } else {
          pushNote({ title: item.title, note }, day.dayIndex, true)
        }
        continue
      }

      if (item.type === 'transit') {
        planned.push({
          exportItem: {
            id: randomUUID(),
            dayIndex: day.dayIndex,
            sortOrder: 0,
            kind: 'transit',
            title: item.title || '交通',
            note,
            timeStart: resolveTime(schedule?.start, item.timeHint),
            timeEnd: resolveTime(schedule?.end, null),
          },
          originalPayload: item.payload,
          // transitBetween 延后补写：需要同天邻居的预生成 id
          transitBetween: { prevItemId: '__pending__', nextItemId: '__pending__' },
        })
        continue
      }

      // free
      pushNote({ title: item.title, note }, day.dayIndex, false)
    }

    // 补写 transitBetween；缺任一侧邻居 → 降级 note
    const normalized: PlannedEntry[] = []
    const transitIndexes: number[] = []

    planned.forEach((entry) => {
      if (entry.transitBetween) transitIndexes.push(normalized.length)
      normalized.push(entry)
    })

    for (const transitIndex of transitIndexes) {
      const entry = normalized[transitIndex]!
      const prevId = [...normalized.slice(0, transitIndex)].reverse().find((candidate) => candidate.exportItem.kind === 'point' || candidate.exportItem.kind === 'place')?.exportItem.id
      const nextId = normalized.slice(transitIndex + 1).find((candidate) => candidate.exportItem.kind === 'point' || candidate.exportItem.kind === 'place')?.exportItem.id
      if (!prevId || !nextId) {
        entry.exportItem = { ...entry.exportItem, kind: 'note' }
        entry.transitBetween = undefined
        entry.originalPayload = null
        degradedToNote += 1
        continue
      }
      const payload = (entry.originalPayload && typeof entry.originalPayload === 'object' && !Array.isArray(entry.originalPayload)
        ? { ...(entry.originalPayload as Record<string, unknown>) }
        : {}) as Record<string, unknown>
      entry.exportItem = {
        ...entry.exportItem,
        payload: { ...payload, transitBetween: { prevItemId: prevId, nextItemId: nextId } } as Prisma.InputJsonValue,
      }
      entry.transitBetween = { prevItemId: prevId, nextItemId: nextId }
    }

    normalized.forEach((entry, index) => {
      items.push({ ...entry.exportItem, sortOrder: index })
    })
  }

  // 合并住宿：同一 placeId 的连续天（dayIndex 相邻）合并为一个区间
  const candidates: ExportLodging[] = []
  for (const occurrence of lodgingOccurrences.values()) {
    const sorted = [...occurrence.dayIndexes].sort((a, b) => a - b)
    let chunkStart = sorted[0]!
    let previous = sorted[0]!
    const flush = (from: number, to: number) => {
      candidates.push({ placeTempId: occurrence.tempId, fromDayIndex: from, toDayIndex: to })
    }

    for (const dayIndex of sorted.slice(1)) {
      if (dayIndex - previous > 1) {
        flush(chunkStart, Math.min(previous + 1, dayCount))
        chunkStart = dayIndex
      }
      previous = dayIndex
    }
    flush(chunkStart, Math.min(previous + 1, dayCount))
  }

  // 换酒店日：把已保留区间的 to 截到后来者的入住日（背靠背）；仍冲突的后者降级为 note
  const degradeLodgingToNote = (candidate: ExportLodging) => {
    const place = places.find((entry) => entry.tempId === candidate.placeTempId)
    const dayItems = items.filter((item) => item.dayIndex === candidate.fromDayIndex)
    const sortOrder = dayItems.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1
    items.push({
      id: randomUUID(),
      dayIndex: candidate.fromDayIndex,
      sortOrder,
      kind: 'note',
      title: place?.title ?? '住宿',
      note: '住宿日期与已有住宿重叠，未导入住宿区间',
    })
    degradedToNote += 1
  }

  candidates.sort((a, b) => a.fromDayIndex - b.fromDayIndex || a.toDayIndex - b.toDayIndex)
  for (const candidate of candidates) {
    for (const keptLodging of lodgings) {
      if (keptLodging.fromDayIndex < candidate.fromDayIndex && keptLodging.toDayIndex > candidate.fromDayIndex) {
        keptLodging.toDayIndex = candidate.fromDayIndex
      }
    }
    try {
      assertLodgingNoOverlap(
        lodgings.map((lodging) => ({ id: lodging.placeTempId, ...lodging })),
        { id: candidate.placeTempId, ...candidate }
      )
      lodgings.push(candidate)
    } catch {
      degradeLodgingToNote(candidate)
    }
  }

  const input: RouteBookExportCreateInput = {
    userId: plan.userId,
    title: plan.title,
    status: EXPORTED_STATUS,
    metadata: {
      sourcePlanId: plan.id,
      startDate: plan.startDate ? plan.startDate.toISOString() : null,
    },
    startDate: plan.startDate,
    dayCount,
    days: exportDays,
    places,
    items,
    lodgings,
  }

  return {
    input,
    counts: {
      days: exportDays.length,
      points: items.filter((item) => item.kind === 'point').length,
      places: places.length,
      notes: items.filter((item) => item.kind === 'note').length,
      transits: items.filter((item) => item.kind === 'transit').length,
      lodgings: lodgings.length,
      degradedToNote,
    },
  }
}
