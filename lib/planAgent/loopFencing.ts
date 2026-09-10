import type { TripPlanRepo } from '@/lib/tripPlan/repo'
import { RunFencedError } from './runFence'

/**
 * 把 repo 的写方法（appendMessage/replaceDays/updateMeta）替换成 token 校验
 * 过的原子版本；校验失败时抛 RunFencedError 而不是静默返回，因为调用点
 * 分散在循环主体和 tools.ts 的工具执行器里，抛异常是唯一能统一从任意调用
 * 深度冒泡回循环顶层的方式。其余方法原样透传（绑定回 target 以保证内部
 * this 正确，与 lib/db/prisma.ts 的 Proxy 用法一致）。
 *
 * 2026-09-10 B 部分：从 loop.ts 原样搬出（loop.ts 贴着 750 行预算，埋点
 * 需要腾位）——逻辑零改动，仅换文件。
 */
export function withFencing(repo: TripPlanRepo, token: string): TripPlanRepo {
  const fenced: Pick<TripPlanRepo, 'appendMessage' | 'replaceDays' | 'updateMeta' | 'replaceDaysWithDaymap'> = {
    async appendMessage(planId, kind, content) {
      const result = await repo.appendMessageIfActive(planId, token, kind, content)
      if (!result) throw new RunFencedError()
      return result
    },
    async replaceDays(planId, days) {
      const result = await repo.replaceDaysIfActive(planId, token, days)
      if (!result) throw new RunFencedError()
      return result
    },
    async updateMeta(planId, patch) {
      const result = await repo.updateMetaIfActive(planId, token, patch)
      if (!result) throw new RunFencedError()
      return result
    },
    async replaceDaysWithDaymap(planId, days, buildDaymapContent) {
      // "替换天数 + 追加 daymap"在 repo 侧已是同一原子窗口；栅栏在窗口外
      // 拦截时两写都不发生，不会出现"天数换了、交付物消息丢了"的半截态
      const result = await repo.replaceDaysWithDaymapIfActive(planId, token, days, buildDaymapContent)
      if (!result) throw new RunFencedError()
      return result
    },
  }
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop in fenced) return fenced[prop as keyof typeof fenced]
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
