/**
 * 工具遥测短语与摘要：供 SSE 的 status / tool_call 事件做"工具名 + 参数/结果 →
 * 中文短语"映射，仅用于客户端思维链展示，不参与任何落库。
 */

const MAX_SUMMARY_LENGTH = 80

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

/** 每个工具调用开始前的中文状态短语 */
export function toolStatusPhrase(name: string, args: unknown): string {
  const a = asRecord(args)
  switch (name) {
    case 'search_anime':
      return `正在搜索作品「${String(a.query ?? '')}」`
    case 'search_bangumi_tv':
      return `正在从 bgm.tv 搜索「${String(a.keyword ?? '')}」`
    case 'list_points':
      return '正在获取点位列表'
    case 'cluster_points':
      return '正在规划每日路线'
    case 'estimate_transit':
      return '正在估算交通方式'
    case 'read_plan':
      return '正在读取当前计划'
    case 'update_plan_meta':
      return '正在更新计划信息'
    case 'save_plan_days':
      return '正在保存行程'
    case 'ask_user':
      return '正在向用户发起提问'
    default:
      return '正在处理…'
  }
}

/** 参数的简短人类可读描述（避免整段 JSON 甩给客户端） */
export function summarizeToolArgs(name: string, args: unknown): string {
  const a = asRecord(args)
  switch (name) {
    case 'search_anime':
      return `作品「${String(a.query ?? '')}」`
    case 'search_bangumi_tv':
      return `关键词「${String(a.keyword ?? '')}」`
    case 'list_points':
      return Number.isFinite(Number(a.bangumiId)) ? `作品 id ${Number(a.bangumiId)}` : '作品 id 未指定'
    case 'cluster_points': {
      const count = Array.isArray(a.pointIds) ? a.pointIds.length : 0
      return `${count} 个点位 · ${Number(a.dayCount) || '?'} 天`
    }
    case 'estimate_transit':
      return `${String(a.fromPointId ?? '?')} → ${String(a.toPointId ?? '?')}`
    case 'read_plan':
      return '读取当前计划'
    case 'update_plan_meta': {
      const fields = ['title', 'dayCount', 'startDate', 'bangumiIds'].filter((k) => k in a)
      return fields.length ? `更新 ${fields.join('、')}` : '无变更'
    }
    case 'save_plan_days':
      return `${Array.isArray(a.days) ? a.days.length : 0} 天行程`
    case 'ask_user':
      return `提问「${String(a.prompt ?? '').slice(0, 40)}」`
    default: {
      const raw = JSON.stringify(a) ?? '{}'
      return raw.length > MAX_SUMMARY_LENGTH ? `${raw.slice(0, MAX_SUMMARY_LENGTH)}…` : raw
    }
  }
}

/** 工具执行结果的简短摘要（从结果 JSON 里提炼，失败时给出错误信息） */
export function summarizeToolResult(name: string, resultJson: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(resultJson)
  } catch {
    return '已完成'
  }
  const r = asRecord(parsed)
  if (typeof r.error === 'string' && r.error) return `失败：${r.error}`
  switch (name) {
    case 'list_points':
      return `找到 ${Array.isArray(r.points) ? r.points.length : 0} 个点位`
    case 'cluster_points':
      return `分成 ${Array.isArray(r.clusters) ? r.clusters.length : 0} 天`
    case 'save_plan_days':
      return `已保存 ${Number.isFinite(Number(r.savedDays)) ? Number(r.savedDays) : 0} 天`
    case 'search_anime':
      return `返回 ${Array.isArray(r.results) ? r.results.length : 0} 个结果`
    case 'search_bangumi_tv':
      return `返回 ${Array.isArray(r.candidates) ? r.candidates.length : 0} 个候选`
    case 'estimate_transit':
      if (r.mode === 'walk' && Number.isFinite(Number(r.durationMin))) return `步行 ${Number(r.durationMin)} 分钟`
      if (r.mode === 'transit' && Number.isFinite(Number(r.durationMin))) return `公共交通 ${Number(r.durationMin)} 分钟`
      return '已完成'
    default:
      return '已完成'
  }
}
