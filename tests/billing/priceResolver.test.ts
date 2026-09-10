import { describe, expect, it } from 'vitest'
import { costOfUsageAtPrice, priceModelCall, pricingWindowOf, resolveModelPrice } from '@/lib/billing/priceResolver'
import { MODEL_PRICES } from '@/lib/billing/priceTable'
import type { LlmModelConfig } from '@/lib/llm/types'

const utc = (iso: string) => new Date(iso)
const usage = (inputMiss: number, inputCacheHit: number, output: number) => ({ inputMiss, inputCacheHit, output, reasoning: 0 })

// 2026-09-10 是周四：09-11 周五、09-12 周六、09-13 周日、09-14 周一、09-18 周五、09-19 周六、09-20 周日

describe('pricingWindowOf（UTC 周一至周五，边界左闭右开）', () => {
  it('四个边界：01:00/06:00 闭端算 peak，04:00/10:00 开端算 offPeak', () => {
    expect(pricingWindowOf(utc('2026-09-14T00:59:59.999Z'))).toBe('offPeak')
    expect(pricingWindowOf(utc('2026-09-14T01:00:00.000Z'))).toBe('peak')
    expect(pricingWindowOf(utc('2026-09-14T03:59:59.999Z'))).toBe('peak')
    expect(pricingWindowOf(utc('2026-09-14T04:00:00.000Z'))).toBe('offPeak')
    expect(pricingWindowOf(utc('2026-09-14T05:59:59.999Z'))).toBe('offPeak')
    expect(pricingWindowOf(utc('2026-09-14T06:00:00.000Z'))).toBe('peak')
    expect(pricingWindowOf(utc('2026-09-14T09:59:59.999Z'))).toBe('peak')
    expect(pricingWindowOf(utc('2026-09-14T10:00:00.000Z'))).toBe('offPeak')
  })

  it('工作日 peak 之外的时段（午间/深夜/凌晨 4–6 点）都是 offPeak；周五仍算工作日', () => {
    for (const t of ['2026-09-14T00:30:00Z', '2026-09-14T05:00:00Z', '2026-09-14T12:00:00Z', '2026-09-14T23:59:59Z']) {
      expect(pricingWindowOf(utc(t))).toBe('offPeak')
    }
    expect(pricingWindowOf(utc('2026-09-18T02:00:00Z'))).toBe('peak')
    expect(pricingWindowOf(utc('2026-09-18T22:00:00Z'))).toBe('offPeak')
  })

  it('周末全天 offPeak（周六/周日落在 peak 窗口内的时刻也一样）', () => {
    for (const t of [
      '2026-09-12T01:00:00Z',
      '2026-09-12T02:30:00Z',
      '2026-09-12T09:59:59Z',
      '2026-09-13T06:00:00Z',
      '2026-09-13T12:00:00Z',
      '2026-09-13T23:00:00Z',
    ]) {
      expect(pricingWindowOf(utc(t))).toBe('offPeak')
    }
  })
})

describe('resolveModelPrice（P1 解析优先级）', () => {
  it('P0：deepseek-flash 命中表价而非 default', () => {
    const resolved = resolveModelPrice('deepseek-flash')
    expect(resolved.source).toBe('table')
    expect(resolved.price.peak).toEqual(MODEL_PRICES['deepseek-flash'].peak)
    expect(resolved.price.offPeak).toEqual(MODEL_PRICES['deepseek-flash'].offPeak)
  })

  it('P0 核心：生产 agent 在用的 deepseek-v4.1-flash-expires-on-0910 命中表价（Flash）而非 default，不进 priceFallbackModels', () => {
    const resolved = resolveModelPrice('deepseek-v4.1-flash-expires-on-0910')
    // 只有走 default 兜底（优先级第 3 条）的模型才会被调用方记入 priceFallbackModels 并告警；
    // source=table 即等价于「不进 priceFallbackModels」。
    expect(resolved.source).toBe('table')
    expect(resolved.price.peak).toEqual(MODEL_PRICES['deepseek-flash'].peak)
    expect(resolved.price.peak).not.toEqual(MODEL_PRICES['deepseek-v4-pro'].peak)
  })

  it('P0：四个 DeepSeek Flash 系列名字都命中表价且解析到同一档 Flash 价', () => {
    const flashNames = [
      'deepseek-flash',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4.1-flash-expires-on-0910',
    ]
    for (const name of flashNames) {
      const r = resolveModelPrice(name)
      expect(r.source).toBe('table')
      expect(r.price.peak).toEqual(MODEL_PRICES['deepseek-flash'].peak)
      expect(r.price.offPeak).toEqual(MODEL_PRICES['deepseek-flash'].offPeak)
    }
  })

  it('deepseek-v4-pro 仍是 PRO 价（2026-09-14 04:00 UTC 起才由维护者手工切档，本表不自动切）', () => {
    const resolved = resolveModelPrice('deepseek-v4-pro')
    expect(resolved.source).toBe('table')
    expect(resolved.price.peak).toEqual({ inputMissPerM: 1_320_000, inputCacheHitPerM: 44_000, outputPerM: 3_960_000 })
    expect(resolved.price.offPeak).toEqual({ inputMissPerM: 660_000, inputCacheHitPerM: 22_000, outputPerM: 1_980_000 })
  })

  it('default 兜底 = Flash peak（不再是最贵档）', () => {
    expect(MODEL_PRICES.default.peak).toEqual(MODEL_PRICES['deepseek-flash'].peak)
    expect(MODEL_PRICES.default.offPeak).toEqual(MODEL_PRICES['deepseek-flash'].offPeak)
  })

  it('P1：DB 供应商的价格覆盖表价，offPeak = peak 减半', () => {
    const providerModels: LlmModelConfig[] = [
      { name: 'deepseek-flash', contextLength: 128000, inputMissPerM: 100_000, inputCacheHitPerM: 1_000, outputPerM: 500_000 },
    ]
    const resolved = resolveModelPrice('deepseek-flash', providerModels)
    expect(resolved.source).toBe('provider')
    expect(resolved.price.peak).toEqual({ inputMissPerM: 100_000, inputCacheHitPerM: 1_000, outputPerM: 500_000 })
    expect(resolved.price.offPeak).toEqual({ inputMissPerM: 50_000, inputCacheHitPerM: 500, outputPerM: 250_000 })
  })

  it('P1：三个价格字段缺任一个（或含 null/负值）视为未配置，回落表价', () => {
    const base = { name: 'deepseek-flash', contextLength: 128000 } as LlmModelConfig
    const incomplete: LlmModelConfig[] = [
      { ...base, inputMissPerM: 1, inputCacheHitPerM: 2 }, // 缺 outputPerM
      { ...base, inputMissPerM: 1, outputPerM: 3 }, // 缺 inputCacheHitPerM
      { ...base, inputCacheHitPerM: 2, outputPerM: 3 }, // 缺 inputMissPerM
      { ...base, inputMissPerM: null, inputCacheHitPerM: 2, outputPerM: 3 }, // null 视为未填
      { ...base, inputMissPerM: -1, inputCacheHitPerM: 2, outputPerM: 3 }, // 负值视为畸形
      { ...base, inputMissPerM: Number.NaN, inputCacheHitPerM: 2, outputPerM: 3 }, // NaN 视为畸形
    ]
    for (const models of incomplete.map((m) => [m])) {
      expect(resolveModelPrice('deepseek-flash', models).source).toBe('table')
    }
  })

  it('供应商列表里没有该模型 → 不算 provider 命中，走表价/default', () => {
    const providerModels: LlmModelConfig[] = [
      { name: 'other-model', contextLength: 128000, inputMissPerM: 1, inputCacheHitPerM: 1, outputPerM: 1 },
    ]
    expect(resolveModelPrice('deepseek-flash', providerModels).source).toBe('table')
    expect(resolveModelPrice('totally-unknown', providerModels).source).toBe('default')
  })

  it('未知模型 → default（Flash peak 兜底）；F5：原型链键（constructor/toString）按 default 计价且不为 NaN', () => {
    const resolved = resolveModelPrice('totally-unknown')
    expect(resolved.source).toBe('default')
    expect(resolved.price.peak).toEqual(MODEL_PRICES.default.peak)
    for (const protoKey of ['constructor', 'toString', '__proto__']) {
      const r = resolveModelPrice(protoKey)
      expect(r.source).toBe('default')
      expect(costOfUsageAtPrice(usage(1_000_000, 0, 0), r.price.peak)).toBe(MODEL_PRICES.default.peak.inputMissPerM)
    }
  })
})

describe('priceModelCall（P2 逐次计价）', () => {
  // 真实 run 实测的 token 构成（plans/2026-09-10 §1）
  it('同一 usage：peak 与 offPeak 各按各的时段价计（offPeak ≈ 半价），输出有限整数微美元', () => {
    const u = usage(31_657, 158_592, 26_256)
    const peak = priceModelCall('deepseek-flash', u, utc('2026-09-14T02:00:00Z'))
    const offPeak = priceModelCall('deepseek-flash', u, utc('2026-09-14T12:00:00Z'))
    expect(peak).toMatchObject({ window: 'peak', source: 'table' })
    expect(offPeak).toMatchObject({ window: 'offPeak', source: 'table' })
    // peak：31,657×0.30 + 158,592×0.006 + 26,256×1.20 = 41,955.852 微美元
    expect(peak.micros).toBe(41_956)
    // offPeak 价减半：20,977.926 → 20,978
    expect(offPeak.micros).toBe(20_978)
    expect(peak.micros).not.toBe(offPeak.micros)
  })

  it('供应商价格参与逐次计价（P1×P2 叠加）', () => {
    const providerModels: LlmModelConfig[] = [
      { name: 'deepseek-flash', contextLength: 128000, inputMissPerM: 100_000, inputCacheHitPerM: 0, outputPerM: 500_000 },
    ]
    const peak = priceModelCall('deepseek-flash', usage(1_000_000, 0, 1_000_000), utc('2026-09-14T02:00:00Z'), providerModels)
    const off = priceModelCall('deepseek-flash', usage(1_000_000, 0, 1_000_000), utc('2026-09-14T12:00:00Z'), providerModels)
    expect(peak).toMatchObject({ micros: 600_000, source: 'provider' })
    expect(off).toMatchObject({ micros: 300_000, source: 'provider' })
  })
})
