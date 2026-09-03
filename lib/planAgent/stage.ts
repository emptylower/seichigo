import type { PlanQualityReport } from './gates'
import type { EnrichReport } from './enrich/types'
import type { TripPlanMessage, TripPlanWithDays } from '@/lib/tripPlan/repo'

/**
 * 阶段由持久化证据推断（设计 §3），不存"当前阶段"作为唯一真值：断线、空回合、
 * 进程重启、并发接管后，下一轮都从这里续跑。TripPlan.stage 只是缓存与展示，
 * 不一致时以推断为准并回写。模型可按用户意图跳转（如中途换作品 → works）。
 */

export type PlanStage = 'works' | 'dates' | 'points' | 'enrich' | 'deliver' | 'revise'

export const STAGE_LABELS: Record<PlanStage, string> = {
  works: '确认作品',
  dates: '确认日期',
  points: '拉取点位',
  enrich: '补齐中',
  deliver: '已交付',
  revise: '修订中',
}

const STAGE_DESCRIPTIONS: Record<PlanStage, string> = {
  works: '尚未确定巡礼作品',
  dates: '已确定作品，缺出行日期或天数',
  points: '日期已定，点位尚未拉取/排天',
  enrich: '有行程但质量门控未过',
  deliver: '行程已通过质量门控并交付',
  revise: '交付后用户提出了新的修改',
}

const STAGE_SUGGESTIONS: Record<PlanStage, string> = {
  works: '先用 search_anime（必要时 search_bangumi_tv + ask_user）与用户确认巡礼作品。',
  dates: '尽快用 ask_user（taskType=date_range）确认出行日期与天数。',
  points: '用 list_points 拉取点位、cluster_points 排天，再逐段查交通。',
  enrich: '优先按下方整改单补齐（交通/坐标/出处），补完再重新保存完整行程。',
  deliver: '等待用户的下一步指令；被问及时总结当前行程即可。',
  revise: '按用户最新要求调整行程，调整后必须重新一次性完整保存。',
}

const GATE_LABELS: Record<string, string> = {
  coords: '坐标门',
  transport: '交通门',
  schedule: '时间门',
  provenance: '出处门',
  density: '密度门',
  media: '图片门',
  estimate_ratio: '估算门',
}

export function derivePlanStage(input: {
  plan: TripPlanWithDays
  messages: TripPlanMessage[]
  quality: PlanQualityReport | null
}): PlanStage {
  const { plan, messages, quality } = input
  if (!plan.bangumiIds.length) return 'works'
  if (!plan.startDate || plan.dayCount <= 1) return 'dates'
  const hasPointItem = plan.days.some((day) => day.items.some((item) => item.pointId))
  if (!plan.days.length || !hasPointItem) return 'points'
  if (quality && !quality.passed) return 'enrich'
  const lastDaymapIndex = findLastIndex(messages, (m) => m.kind === 'daymap')
  // 有 days 却从未交付过 daymap（历史遗留数据）：回到补齐阶段重走门控
  if (lastDaymapIndex < 0) return 'enrich'
  const humanAfterDaymap = messages.slice(lastDaymapIndex + 1).some((m) => m.kind === 'human')
  return humanAfterDaymap ? 'revise' : 'deliver'
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i
  }
  return -1
}

function describeGateFailures(quality: PlanQualityReport): string {
  const parts: string[] = []
  if (quality.hard.length) {
    const byGate = new Map<string, number>()
    for (const failure of quality.hard) byGate.set(failure.gate, (byGate.get(failure.gate) ?? 0) + 1)
    const summary = [...byGate.entries()].map(([gate, n]) => `${GATE_LABELS[gate] ?? gate} ${n} 处`).join('、')
    const examples = quality.hard
      .slice(0, 3)
      .map((f) => (f.itemTitle ? `Day${f.dayIndex} ${f.itemTitle}：${f.fix}` : f.fix))
      .join('；')
    parts.push(`未通过：${summary}（${examples}${quality.hard.length > 3 ? `；等共 ${quality.hard.length} 处` : ''}）`)
  }
  if (quality.soft.length) {
    const byGate = new Map<string, number>()
    for (const failure of quality.soft) byGate.set(failure.gate, (byGate.get(failure.gate) ?? 0) + 1)
    const summary = [...byGate.entries()].map(([gate, n]) => `${GATE_LABELS[gate] ?? gate} ${n} 处`).join('、')
    parts.push(`提示（不影响保存）：${summary}`)
  }
  return parts.join('\n')
}

function describeEnrichReport(enrich: EnrichReport): string {
  const names: Array<[keyof EnrichReport['applied'], string]> = [
    ['place', '地点'],
    ['restaurant', '餐厅'],
    ['transport', '交通'],
    ['media', '图片'],
    ['neighbor', '邻近图'],
  ]
  const appliedParts = names.filter(([key]) => (enrich.applied[key] ?? 0) > 0).map(([key, label]) => `${label} ${enrich.applied[key]}`)
  if (!appliedParts.length && !enrich.skipped.length) return ''
  const skippedNote = enrich.skipped.length ? `；跳过 ${enrich.skipped.length} 项（详见保存返回）` : ''
  return `服务端已自动补齐：${appliedParts.length ? appliedParts.join('、') : '无'}${skippedNote}。`
}

/**
 * 追加到 system prompt 尾部的中文段落（≤600 字）：当前阶段、未通过门控与
 * 建议的下一步。是服务端生成的一两句上下文，不是硬指令——模型仍可按用户
 * 意图跳转阶段。
 */
export function buildStageContext(stage: PlanStage, quality: PlanQualityReport | null, enrich?: EnrichReport): string {
  const lines: string[] = [`## 当前状态`, `阶段：${STAGE_LABELS[stage]}（${STAGE_DESCRIPTIONS[stage]}）。`]
  if (stage === 'enrich' && quality && !quality.passed) lines.push(describeGateFailures(quality))
  else if (quality && quality.soft.length) lines.push(describeGateFailures(quality))
  if (enrich) {
    const enrichLine = describeEnrichReport(enrich)
    if (enrichLine) lines.push(enrichLine)
  }
  lines.push(`建议下一步：${STAGE_SUGGESTIONS[stage]}`)
  lines.push('你可以按用户最新意图跳转阶段。')
  const text = lines.join('\n')
  return text.length > 600 ? `${text.slice(0, 597)}…` : text
}
