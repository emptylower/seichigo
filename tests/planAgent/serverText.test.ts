import { describe, expect, it } from 'vitest'
import { serverText } from '@/lib/planAgent/serverText'
import type { ServerTextDict } from '@/lib/planAgent/serverText'
import type { SupportedLocale } from '@/lib/i18n/types'

type Dict = Record<string, unknown>

/** 递归取键路径（a.b.c）；函数值只记键名（三语实现必然不同，按名比对） */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [prefix]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix || '?']
  const out: string[] = []
  for (const [key, child] of Object.entries(value as Dict)) {
    out.push(...keyPaths(child, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

describe('serverText 三语字典', () => {
  it('zh / en / ja 键路径集合完全一致（函数值按键名比）', () => {
    const zh = keyPaths(serverText('zh')).sort()
    const en = keyPaths(serverText('en')).sort()
    const ja = keyPaths(serverText('ja')).sort()
    expect(en).toEqual(zh)
    expect(ja).toEqual(zh)
  })

  it('status / summary / result / errors / meal 段都在', () => {
    for (const locale of ['zh', 'en', 'ja'] as SupportedLocale[]) {
      const d: ServerTextDict = serverText(locale)
      expect(d.status.searchAnime('x')).toBeTruthy()
      expect(d.status.processing).toBeTruthy()
      expect(d.summary.work('x')).toBeTruthy()
      expect(d.result.done).toBeTruthy()
      expect(typeof d.result.failed).toBe('function')
      expect(d.errors.notSignedIn).toBeTruthy()
      expect(d.meal.breakfast).toBeTruthy()
      expect(d.meal.lunch).toBeTruthy()
      expect(d.meal.dinner).toBeTruthy()
      expect(d.netError).toBeTruthy()
      expect(d.askUserNote).toBeTruthy()
    }
  })

  it('zh 文案与现有原文逐字一致（抽查关键句）', () => {
    const d = serverText('zh')
    expect(d.status.searchAnime('上低音号')).toBe('正在搜索作品「上低音号」')
    expect(d.status.processing).toBe('正在处理…')
    expect(d.result.walkMin(9)).toBe('步行 9 分钟')
    expect(d.result.failed('x')).toBe('失败：x')
    expect(d.result.done).toBe('已完成')
    expect(d.netError).toBe(
      '网络连接不稳定，本轮回复被中断。已完成的规划内容和行程不会丢失，请再发一条消息继续即可。',
    )
    expect(d.errors.notSignedIn).toBe('未登录')
    expect(d.errors.planNotFound).toBe('计划不存在')
    expect(d.errors.forbidden).toBe('无权访问')
    expect(d.errors.agentQuotaExhausted).toBe('今日 AI 规划额度已用完，明天再来吧')
    expect(d.errors.planBusy).toBe('这个计划正在规划中，等当前回复完成后再发送')
    expect(d.errors.createQuotaExhausted).toBe('今日创建计划次数已达上限，明天再来吧')
    expect(d.meal.breakfast).toBe('早餐')
    expect(d.meal.lunch).toBe('午餐')
    expect(d.meal.dinner).toBe('晚餐')
  })

  it('en / ja 文案非空且不含中文占位残留', () => {
    for (const locale of ['en', 'ja'] as SupportedLocale[]) {
      const d = serverText(locale)
      expect(d.status.searchAnime('x')).not.toContain('{')
      expect(d.errors.notSignedIn.length).toBeGreaterThan(0)
      expect(d.netError.length).toBeGreaterThan(0)
    }
  })
})
