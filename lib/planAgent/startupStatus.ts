import type { PlanAgentEvent } from './loop'
import { serverText } from './serverText'
import type { SupportedLocale } from '@/lib/i18n/types'

/**
 * 2026-09-10 首帧优化：run 启动阶段的实况 status。
 *
 * 在 listMessages → getPlan/阶段推断 → 首次模型调用这几段真实存在的串行
 * 步骤上各发一条 status，让 DeepSeek TTFT（1–3 秒）+ 启动数据库往返
 * （2–4 秒）期间观察流有真实进度可渲染，而不是通用兜底文案卡黑屏。
 * 只发真实发生的步骤——不编造阶段、不做百分比假进度。
 */

/** 启动阶段的三个真实步骤（与 loop.ts 中的发射点一一对应） */
export type StartupStatusPhase = 'readHistory' | 'checkProgress' | 'organize'

/** 启动步骤的站点语言短语（文案在 serverText.status 三语字典） */
export function startupStatusPhrase(phase: StartupStatusPhase, locale: SupportedLocale): string {
  return serverText(locale).status[phase]
}

/**
 * 启动 status 发送器。active=false（启动即已被新请求接管，或用户已停止——
 * isAgentRunStopped 判定 token 不再匹配）时返回 no-op：绝不以旧 token 把
 * 启动实况写到实况行上覆盖新 run（runLive M2 的栅栏语义）。
 */
export function createStartupStatusEmitter(
  emit: (event: PlanAgentEvent) => void,
  locale: SupportedLocale,
  active: boolean,
): (phase: StartupStatusPhase) => void {
  if (!active) return () => undefined
  return (phase) => emit({ type: 'status', phase: startupStatusPhrase(phase, locale) })
}
