import { z } from 'zod'
import { DAY_COUNT_MAX } from '@/lib/routeBook/repo'

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '时间格式应为 HH:mm')
export const travelModeSchema = z.enum(['transit', 'walking', 'driving'])
export const itemKindSchema = z.enum(['point', 'place', 'note', 'transit'])
export const placeKindSchema = z.enum(['lodging', 'station', 'restaurant', 'other'])
export const noteIconSchema = z.enum(['info', 'clock', 'train', 'utensils', 'ticket', 'camera', 'shopping-bag', 'alert', 'star', 'bookmark'])
export const noteColorSchema = z.enum(['gray', 'pink', 'amber', 'green', 'sky', 'violet'])

export const createItemSchema = z
  .object({
    dayId: z.string().min(1).nullable(),
    kind: itemKindSchema,
    pointId: z.string().min(1).optional(),
    placeId: z.string().min(1).optional(),
    title: z.string().trim().max(120).optional(),
    note: z.string().max(2000).optional(),
    timeStart: hhmm.optional(),
    index: z.number().int().min(0).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'point' && !v.pointId) ctx.addIssue({ code: 'custom', message: '点位条目缺少 pointId' })
    if (v.kind === 'place' && !v.placeId) ctx.addIssue({ code: 'custom', message: '自定义点条目缺少 placeId' })
    if ((v.kind === 'note' || v.kind === 'transit') && !v.title) ctx.addIssue({ code: 'custom', message: '标题不能为空' })
  })

export const updateItemSchema = z
  .object({
    title: z.string().trim().max(120).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    timeStart: hhmm.nullable().optional(),
    timeEnd: hhmm.nullable().optional(),
    locked: z.boolean().optional(),
    icon: noteIconSchema.nullable().optional(),
    color: noteColorSchema.nullable().optional(),
    legMode: travelModeSchema.nullable().optional(),
  })
  .refine((v) => !(v.timeStart && v.timeEnd) || v.timeEnd >= v.timeStart, { message: '结束时间不能早于开始时间' })

// 未安排区不限数量，上限只是防滥用；乐观锁 updatedAt 只由 PATCH / 携带（契约 5）
export const reorderItemsSchema = z.object({
  dayId: z.string().min(1).nullable(),
  orderedItemIds: z.array(z.string().min(1)).max(500),
})

export const insertDaySchema = z.object({ afterDayIndex: z.number().int().min(0).max(DAY_COUNT_MAX) })
export const updateDaySchema = z.object({
  title: z.string().trim().max(60).nullable().optional(),
  defaultTravelMode: travelModeSchema.optional(),
})
export const reorderDaysSchema = z.object({ orderedDayIds: z.array(z.string().min(1)).min(1) })

export const placeSchema = z.object({
  kind: placeKindSchema,
  title: z.string().trim().min(1).max(120),
  address: z.string().max(300).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  googlePlaceId: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export const lodgingBaseSchema = z.object({
  placeId: z.string().min(1),
  fromDayIndex: z.number().int().min(1),
  toDayIndex: z.number().int().min(1),
  checkIn: hhmm.nullable().optional(),
  checkOut: hhmm.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export const lodgingSchema = lodgingBaseSchema.refine((v) => v.toDayIndex >= v.fromDayIndex, {
  message: '退房日不能早于入住日',
})
