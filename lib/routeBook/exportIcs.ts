/**
 * ICS（RFC 5545）导出（纯函数）：
 * - 每个有日期的天一个全天 VEVENT（SUMMARY = 天标题或 Day N，DESCRIPTION = 当天条目清单）
 * - 每条有 timeStart 的条目一个定时 VEVENT（DTSTART;TZID=Asia/Tokyo，timeEnd 缺省/不晚于开始 +60 分钟）
 * - 内嵌 Asia/Tokyo 的 VTIMEZONE（JST 无夏令时，单一 STANDARD 即可）
 * - UID = <itemId>@seichigo.com；TEXT 转义（; , \ 换行）；行按 75 字节折叠（CRLF + 空格）
 */

import type { RouteBookDay, RouteBookItem, RouteBookPlace } from '@/lib/routeBook/repo'

export type IcsPointPreview = { title: string }

export type IcsExportInput = {
  title: string
  days: RouteBookDay[]
  items: RouteBookItem[]
  places: RouteBookPlace[]
  previews: Map<string, IcsPointPreview>
  /** DTSTAMP 时间源（缺省当前时间）；测试注入固定值 */
  now?: Date
}

const CRLF = '\r\n'
const UID_DOMAIN = 'seichigo.com'

/** Asia/Tokyo 无夏令时：单一 STANDARD（+0900）即完整定义 */
const VTIMEZONE_LINES = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tokyo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'END:STANDARD',
  'END:VTIMEZONE',
]

/** RFC 5545 TEXT 转义：反斜杠、分号、逗号、换行 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** 75 字节折叠：首行 ≤75，续行 = 空格 + ≤74；不拆开 UTF-8 多字节字符 */
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of line) {
    const len = encoder.encode(ch).length
    if (currentBytes + len > 75) {
      chunks.push(current)
      current = ` ${ch}`
      currentBytes = 1 + len
    } else {
      current += ch
      currentBytes += len
    }
  }
  chunks.push(current)
  return chunks.join(CRLF)
}

function dateCompact(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

function addOneDay(dateOnly: string): string {
  const ms = Date.parse(`${dateOnly}T00:00:00Z`) + 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function hhmmToMinutes(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function minutesToHHmm(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function buildIcs(input: IcsExportInput): string {
  const { days, items, places, previews } = input
  const placeById = new Map(places.map((place) => [place.id, place]))
  const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'

  const itemTitle = (item: RouteBookItem): string => {
    if (item.kind === 'point' && item.pointId) {
      const preview = previews.get(item.pointId)
      if (preview) return preview.title
    }
    if (item.kind === 'place' && item.placeId) {
      const place = placeById.get(item.placeId)
      if (place) return place.title
    }
    return item.title ?? (item.kind === 'note' ? '备注' : item.kind === 'transit' ? '交通' : '条目')
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SeichiGo//RouteBook//ZH',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(input.title.trim() || '行程本')}`,
    ...VTIMEZONE_LINES,
  ]

  const pushEvent = (contentLines: string[]) => {
    lines.push('BEGIN:VEVENT', ...contentLines, 'END:VEVENT')
  }

  for (const day of [...days].sort((a, b) => a.dayIndex - b.dayIndex)) {
    if (!day.date) continue
    const dateOnly = day.date.toISOString().slice(0, 10)
    const dayItems = items
      .filter((item) => item.dayId === day.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    // 全天事件：天标题 / Day N + 当天条目清单
    const summary = day.title?.trim() ? day.title.trim() : `Day ${day.dayIndex}`
    const description = dayItems.map((item) => `${item.timeStart ? `${item.timeStart} ` : ''}${itemTitle(item)}`).join('\n')
    pushEvent([
      `UID:${day.id}@${UID_DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateCompact(dateOnly)}`,
      `DTEND;VALUE=DATE:${dateCompact(addOneDay(dateOnly))}`,
      `SUMMARY:${escapeText(summary)}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ])

    // 定时事件：有 timeStart 且当天有日期的条目
    for (const item of dayItems) {
      if (!item.timeStart) continue
      const startMin = hhmmToMinutes(item.timeStart)
      if (startMin === null) continue
      const parsedEnd = item.timeEnd ? hhmmToMinutes(item.timeEnd) : null
      // timeEnd 缺省或不晚于 timeStart（如 23:50–00:10 跨夜写反）时，统一 +60 分钟
      const endMin = parsedEnd !== null && parsedEnd > startMin ? parsedEnd : startMin + 60
      let endDate = dateOnly
      let endMinWrapped = endMin
      if (endMinWrapped >= 1440) {
        endDate = addOneDay(dateOnly)
        endMinWrapped -= 1440
      }
      const startHH = item.timeStart.slice(0, 2) + item.timeStart.slice(3, 5)
      pushEvent([
        `UID:${item.id}@${UID_DOMAIN}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=Asia/Tokyo:${dateCompact(dateOnly)}T${startHH}00`,
        `DTEND;TZID=Asia/Tokyo:${dateCompact(endDate)}T${minutesToHHmm(endMinWrapped).replace(':', '')}00`,
        `SUMMARY:${escapeText(itemTitle(item))}`,
        ...(item.note ? [`DESCRIPTION:${escapeText(item.note)}`] : []),
      ])
    }
  }

  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}
