/**
 * 工具遥测短语与摘要：供 SSE 的 status / tool_call 事件做"工具名 + 参数/结果 →
 * 状态短语"映射，仅用于客户端思维链展示，不参与任何落库。文案取自
 * serverText(locale)（§0.6 三语字典；缺省 zh 与原行为逐字一致）。
 */

import type { SupportedLocale } from '@/lib/i18n/types'
import { serverText } from './serverText'

const MAX_SUMMARY_LENGTH = 80

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

/** 每个工具调用开始前的状态短语（站点语言） */
export function toolStatusPhrase(name: string, args: unknown, locale: SupportedLocale = 'zh'): string {
  const a = asRecord(args)
  const d = serverText(locale)
  switch (name) {
    case 'search_anime':
      return d.status.searchAnime(String(a.query ?? ''))
    case 'search_bangumi_tv':
      return d.status.searchBangumi(String(a.keyword ?? ''))
    case 'list_points':
      return d.status.listPoints
    case 'cluster_points':
      return d.status.clusterPoints
    case 'estimate_transit':
      return d.status.estimateTransit
    case 'estimate_travel': {
      const mode = String(a.mode ?? '')
      return mode === 'driving' ? d.status.travelDriving : mode === 'walk' ? d.status.travelWalk : d.status.travelTransit
    }
    case 'resolve_place':
      return d.status.resolvePlace(String(a.query ?? ''))
    case 'read_plan':
      return d.status.readPlan
    case 'update_plan_meta':
      return d.status.updateMeta
    case 'save_plan_days':
      return d.status.savePlan
    case 'ask_user': {
      // 任务类型术语（M3+）：日期/选作品/征求意见各有专属短语；
      // 无 taskType 的旧载荷保持通用短语
      const taskType = String(a.taskType ?? '')
      if (taskType === 'date_range') return d.status.askDate
      if (taskType === 'work_selection') return d.status.askWork
      if (taskType === 'opinion') return d.status.askOpinion
      return d.status.askGeneric
    }
    default:
      return d.status.processing
  }
}

/** 参数的简短人类可读描述（避免整段 JSON 甩给客户端） */
export function summarizeToolArgs(name: string, args: unknown, locale: SupportedLocale = 'zh'): string {
  const a = asRecord(args)
  const d = serverText(locale)
  switch (name) {
    case 'search_anime':
      return d.summary.work(String(a.query ?? ''))
    case 'search_bangumi_tv':
      return d.summary.keyword(String(a.keyword ?? ''))
    case 'list_points':
      return Number.isFinite(Number(a.bangumiId)) ? d.summary.workId(Number(a.bangumiId)) : d.summary.workIdMissing
    case 'cluster_points': {
      const count = Array.isArray(a.pointIds) ? a.pointIds.length : 0
      return d.summary.pointsDays(count, Number(a.dayCount) || '?')
    }
    case 'estimate_transit':
      return d.summary.fromTo(String(a.fromPointId ?? '?'), String(a.toPointId ?? '?'))
    case 'estimate_travel': {
      const from = asRecord(a.from)
      const to = asRecord(a.to)
      const fromLabel = String(from.pointId ?? from.placeId ?? d.summary.start)
      const toLabel = String(to.pointId ?? to.placeId ?? d.summary.end)
      return d.summary.travel(fromLabel, toLabel, String(a.mode ?? '?'))
    }
    case 'resolve_place':
      return d.summary.place(String(a.query ?? ''))
    case 'read_plan':
      return d.summary.readPlan
    case 'update_plan_meta': {
      const fields = ['title', 'dayCount', 'startDate', 'bangumiIds'].filter((k) => k in a)
      return fields.length ? d.summary.updateFields(fields) : d.summary.noChanges
    }
    case 'save_plan_days':
      return d.summary.daysCount(Array.isArray(a.days) ? a.days.length : 0)
    case 'ask_user':
      return d.summary.ask(String(a.prompt ?? '').slice(0, 40))
    default: {
      const raw = JSON.stringify(a) ?? '{}'
      return raw.length > MAX_SUMMARY_LENGTH ? `${raw.slice(0, MAX_SUMMARY_LENGTH)}…` : raw
    }
  }
}

/** 工具执行结果的简短摘要（从结果 JSON 里提炼，失败时给出错误信息） */
export function summarizeToolResult(name: string, resultJson: string, locale: SupportedLocale = 'zh'): string {
  const d = serverText(locale)
  let parsed: unknown
  try {
    parsed = JSON.parse(resultJson)
  } catch {
    return d.result.done
  }
  const r = asRecord(parsed)
  if (typeof r.error === 'string' && r.error) return d.result.failed(r.error)
  switch (name) {
    case 'list_points':
      return d.result.foundPoints(Array.isArray(r.points) ? r.points.length : 0)
    case 'cluster_points':
      return d.result.clusteredDays(Array.isArray(r.clusters) ? r.clusters.length : 0)
    case 'save_plan_days':
      return d.result.savedDays(Number.isFinite(Number(r.savedDays)) ? Number(r.savedDays) : 0)
    case 'search_anime':
      return d.result.searchResults(Array.isArray(r.results) ? r.results.length : 0)
    case 'search_bangumi_tv':
      return d.result.searchCandidates(Array.isArray(r.candidates) ? r.candidates.length : 0)
    case 'estimate_transit':
      if (r.mode === 'walk' && Number.isFinite(Number(r.durationMin))) return d.result.walkMin(Number(r.durationMin))
      if (r.mode === 'transit' && Number.isFinite(Number(r.durationMin))) return d.result.transitMin(Number(r.durationMin))
      return d.result.done
    case 'estimate_travel':
      if (Number.isFinite(Number(r.durationMin))) {
        const minutes = Number(r.durationMin)
        if (r.mode === 'driving') return d.result.drivingMin(minutes)
        if (r.mode === 'walk') return d.result.walkMin(minutes)
        return d.result.transitMin(minutes)
      }
      return d.result.done
    case 'resolve_place':
      if (r.place && typeof (r.place as Record<string, unknown>).name === 'string') {
        return d.result.located((r.place as Record<string, unknown>).name as string)
      }
      return d.result.done
    default:
      return d.result.done
  }
}
