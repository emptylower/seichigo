# plan agent 订阅分档前端实施计划（Part C）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 Plan 页与账户页看到“本月 agent 用量剩余 xx%”，用量耗尽时输入框禁用并给出恢复日期与升级入口；免费档在交通行与餐厅位看到升级提示；定价页展示三档，只有标准档可点，高级档置灰“即将开放”。

**Architecture:** 所有档位信息只来自 `GET /api/me/usage`（后端 Part B 提供，契约见下）。前端新增一个 `useUsage` hook 与一个 `UsageMeter` 组件，PlanSidebar、/me、TransitConnector、DayCards 都从同一份数据渲染，不自行推断档位。定价页是静态页。

**Tech Stack:** Next.js App Router、React、Tailwind、lucide-react、vitest + @testing-library/react（`tests/**/*.test.tsx` 走 jsdom）。

**对应设计：** `docs/superpowers/specs/2026-09-06-plan-agent-billing-tiers-design.md` §4。

**约束（对执行者）：**
- 不要 `git commit`。只改 `app/(authed)/plan/**`、`app/(authed)/me/page.tsx`、新建 `app/(site)/pricing/**`、新建 `hooks/useUsage.ts`、新建 `components/billing/**`、新建 `tests/billing/*.test.tsx`。**不要碰 `lib/**`、`app/api/**`、`prisma/**`。**
- 后端接口可能还没合入。开发时按下面契约写 mock；接口不存在（404）或未登录（401）时组件必须静默隐藏，不报错、不阻断输入。
- 不出现 credits、token、成本、调用次数等任何字样。用户只看到百分比、恢复日期、档位名。
- 遵循现有风格：品牌色 `brand-*`、粉色边框 `pink-100`、圆角与 PlanSidebar 现有一致。

## 接口契约：`GET /api/me/usage`

```ts
export type UsageView = {
  tier: 'free' | 'standard' | 'pro'
  tierLabel: string                 // '免费' | '标准' | '高级'
  remainingPercent: number          // 0..100 整数
  resetsAt: string                  // ISO 时间
  upgradeAvailable: boolean         // 免费档为 true
  hints: {
    transitEstimateOnly: boolean    // 免费档 true：交通行只有参考估算
    restaurantsLocked: boolean      // 免费档 true：不推荐餐厅
    maxDays: number
  }
}
```

`POST /api/me/plans/[id]/agent` 在用量耗尽时返回 **402**：

```json
{ "error": "本月 AI 规划用量已用完，9 月 20 日恢复", "code": "budget_exhausted", "resetsAt": "2026-09-20T00:00:00.000Z", "upgradeAvailable": true }
```

---

## 文件结构

| 文件 | 职责 |
|---|---|
| 新建 `hooks/useUsage.ts` | 拉取契约、缓存、手动 refresh、失败静默 |
| 新建 `components/billing/UsageMeter.tsx` | 进度条 + 文案 + 升级链接（紧凑/完整两种尺寸） |
| 新建 `components/billing/usageText.ts` | 纯函数：百分比文案、恢复日期文案 |
| 修改 `app/(authed)/plan/[id]/components/PlanSidebar.tsx` | 底部嵌入紧凑版 UsageMeter |
| 修改 `app/(authed)/plan/[id]/ui.tsx` | 402 处理：禁用输入 + 提示；done 事件后刷新用量 |
| 修改 `app/(authed)/plan/[id]/components/TransitConnector.tsx` | 估算行在免费档显示升级提示 |
| 修改 `app/(authed)/plan/[id]/components/DayCards.tsx` | 无餐厅的 meal 条目在免费档显示占位卡 |
| 修改 `app/(authed)/me/page.tsx` | 顶部完整版 UsageMeter |
| 新建 `app/(site)/pricing/page.tsx` | 三档定价页 |

---

### Task C1: 文案纯函数 `components/billing/usageText.ts`

**Files:**
- Create: `components/billing/usageText.ts`
- Test: `tests/billing/usageText.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/billing/usageText.test.tsx
import { describe, expect, it } from 'vitest'
import { formatPercent, formatResetDate, usageBarTone } from '@/components/billing/usageText'

describe('usageText', () => {
  it('formatPercent shows <1% for tiny positive values and integers otherwise', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.4)).toBe('<1%')
    expect(formatPercent(37)).toBe('37%')
    expect(formatPercent(100)).toBe('100%')
  })
  it('formatResetDate renders M月D日恢复', () => {
    expect(formatResetDate('2026-09-20T00:00:00.000Z')).toMatch(/^9 月 (19|20) 日恢复$/)
    expect(formatResetDate('not-a-date')).toBe('')
  })
  it('usageBarTone maps percent to a tone', () => {
    expect(usageBarTone(80)).toBe('ok')
    expect(usageBarTone(20)).toBe('low')
    expect(usageBarTone(0)).toBe('empty')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/usageText.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// components/billing/usageText.ts
/** 用户可见文案（设计 §4）：百分比向下取整；0 < x < 1 显示 "<1%" */
export function formatPercent(percent: number): string {
  if (percent <= 0) return '0%'
  if (percent < 1) return '<1%'
  return `${Math.floor(percent)}%`
}

/** "9 月 20 日恢复"；无效日期返回空串 */
export function formatResetDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日恢复`
}

export type UsageTone = 'ok' | 'low' | 'empty'

export function usageBarTone(percent: number): UsageTone {
  if (percent <= 0) return 'empty'
  if (percent <= 25) return 'low'
  return 'ok'
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/billing/usageText.test.tsx`
Expected: PASS。

---

### Task C2: `hooks/useUsage.ts`

**Files:**
- Create: `hooks/useUsage.ts`
- Test: `tests/billing/useUsage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/billing/useUsage.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUsage, USAGE_CHANGED_EVENT } from '@/hooks/useUsage'

const view = {
  tier: 'free',
  tierLabel: '免费',
  remainingPercent: 42,
  resetsAt: '2026-09-20T00:00:00.000Z',
  upgradeAvailable: true,
  hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
}

afterEach(() => vi.unstubAllGlobals())

describe('useUsage', () => {
  it('loads the usage view and exposes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(view), { status: 200 })))
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(42))
    expect(result.current.status).toBe('ready')
  })

  it('stays silent on 401/404/network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.usage).toBeNull()
  })

  it('refetches when the usage-changed event fires', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(view), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...view, remainingPercent: 30 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(42))
    window.dispatchEvent(new Event(USAGE_CHANGED_EVENT))
    await waitFor(() => expect(result.current.usage?.remainingPercent).toBe(30))
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/useUsage.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// hooks/useUsage.ts
'use client'

import { useCallback, useEffect, useState } from 'react'

export type UsageView = {
  tier: 'free' | 'standard' | 'pro'
  tierLabel: string
  remainingPercent: number
  resetsAt: string
  upgradeAvailable: boolean
  hints: { transitEstimateOnly: boolean; restaurantsLocked: boolean; maxDays: number }
}

/** run 结束（SSE done）或 402 后由 Plan 页派发，所有 useUsage 实例重新拉取 */
export const USAGE_CHANGED_EVENT = 'seichigo:usage-changed'

export function notifyUsageChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(USAGE_CHANGED_EVENT))
}

type Status = 'loading' | 'ready' | 'unavailable'

/**
 * 用量视图（设计 §4）。接口不存在、未登录、网络失败都归为 unavailable：
 * 调用方据此整块隐藏，绝不阻断输入。
 */
export function useUsage(): { usage: UsageView | null; status: Status; refresh: () => void } {
  const [usage, setUsage] = useState<UsageView | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  const refresh = useCallback(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me/usage', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as UsageView
        if (cancelled) return
        if (typeof data?.remainingPercent !== 'number' || !data.hints) throw new Error('bad shape')
        setUsage(data)
        setStatus('ready')
      } catch {
        if (cancelled) return
        setUsage(null)
        setStatus('unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = refresh()
    const onChanged = () => {
      refresh()
    }
    window.addEventListener(USAGE_CHANGED_EVENT, onChanged)
    return () => {
      cancel()
      window.removeEventListener(USAGE_CHANGED_EVENT, onChanged)
    }
  }, [refresh])

  return { usage, status, refresh }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/billing/useUsage.test.tsx`
Expected: PASS。

---

### Task C3: `components/billing/UsageMeter.tsx`

**Files:**
- Create: `components/billing/UsageMeter.tsx`
- Test: `tests/billing/UsageMeter.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/billing/UsageMeter.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsageMeter } from '@/components/billing/UsageMeter'

const view = {
  tier: 'free' as const,
  tierLabel: '免费',
  remainingPercent: 42,
  resetsAt: '2026-09-20T00:00:00.000Z',
  upgradeAvailable: true,
  hints: { transitEstimateOnly: true, restaurantsLocked: true, maxDays: 3 },
}

describe('UsageMeter', () => {
  it('renders percent, reset date, tier label and an upgrade link for free users', () => {
    render(<UsageMeter usage={view} size="full" />)
    expect(screen.getByText(/本月 agent 用量剩余 42%/)).toBeInTheDocument()
    expect(screen.getByText(/日恢复/)).toBeInTheDocument()
    expect(screen.getByText('免费')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /升级/ })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  })
  it('hides the upgrade link when not available', () => {
    render(<UsageMeter usage={{ ...view, tier: 'standard', tierLabel: '标准', upgradeAvailable: false }} size="compact" />)
    expect(screen.queryByRole('link', { name: /升级/ })).toBeNull()
  })
  it('renders nothing without usage', () => {
    const { container } = render(<UsageMeter usage={null} size="compact" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/UsageMeter.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
// components/billing/UsageMeter.tsx
'use client'

import Link from 'next/link'
import type { UsageView } from '@/hooks/useUsage'
import { formatPercent, formatResetDate, usageBarTone } from './usageText'

const BAR_TONE: Record<ReturnType<typeof usageBarTone>, string> = {
  ok: 'bg-brand-500',
  low: 'bg-amber-500',
  empty: 'bg-gray-300',
}

/**
 * 用量表（设计 §4）：只显示百分比、恢复日期、档位名与升级入口。
 * compact 用于 Plan 侧栏底部，full 用于账户页。
 */
export function UsageMeter(props: { usage: UsageView | null; size: 'compact' | 'full' }) {
  const { usage, size } = props
  if (!usage) return null
  const percent = Math.max(0, Math.min(100, usage.remainingPercent))
  const tone = usageBarTone(percent)
  const compact = size === 'compact'
  return (
    <section
      aria-label="本月 agent 用量"
      className={compact ? 'rounded-xl border border-pink-100 bg-white/70 px-3 py-2.5' : 'rounded-2xl border border-pink-100 bg-white px-5 py-4 shadow-sm'}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={compact ? 'text-xs font-medium text-gray-700' : 'text-sm font-semibold text-gray-900'}>
          本月 agent 用量剩余 {formatPercent(percent)}
        </p>
        <span className="shrink-0 rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">{usage.tierLabel}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={`mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 ${compact ? '' : 'h-2'}`}
      >
        <div className={`h-full rounded-full transition-[width] ${BAR_TONE[tone]}`} style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
        <span>{formatResetDate(usage.resetsAt)}</span>
        {usage.upgradeAvailable ? (
          <Link href="/pricing" className="font-medium text-brand-600 hover:text-brand-500">
            升级解锁真实路线与餐厅推荐
          </Link>
        ) : null}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/billing/UsageMeter.test.tsx`
Expected: PASS。

---

### Task C4: PlanSidebar 底部嵌入；ui.tsx 处理 402 与 done 刷新

**Files:**
- Modify: `app/(authed)/plan/[id]/components/PlanSidebar.tsx`
- Modify: `app/(authed)/plan/[id]/ui.tsx`

- [ ] **Step 1: PlanSidebar**

在 `PlanSidebar` 组件内调用 `const { usage } = useUsage()`，并把侧栏列表 `list` 的 JSX 改成上下结构：现有列表放在 `flex-1 overflow-y-auto` 容器里，底部追加：

```tsx
      <div className="border-t border-pink-100/80 p-3">
        <UsageMeter usage={usage} size="compact" />
      </div>
```

import：`import { useUsage } from '@/hooks/useUsage'` 与 `import { UsageMeter } from '@/components/billing/UsageMeter'`。桌面 `<aside>` 与移动抽屉 `<aside>` 共用同一份 `list`，两处都会带上。

- [ ] **Step 2: ui.tsx 的 402 与 done**

1. 新增状态：`const [budgetExhausted, setBudgetExhausted] = useState<{ message: string; upgradeAvailable: boolean } | null>(null)`
2. 在 agent 请求的 `if (!res.ok || !res.body || ...)` 分支里、`appendLocalChat` 之前加：

```tsx
        if (res.status === 402 && errBody?.code === 'budget_exhausted') {
          setBudgetExhausted({ message: errBody.error ?? '本月 AI 规划用量已用完', upgradeAvailable: Boolean((errBody as { upgradeAvailable?: boolean }).upgradeAvailable) })
          notifyUsageChanged()
          return
        }
```

并把 `errBody` 的类型扩为 `{ error?: string; reason?: string; code?: string; upgradeAvailable?: boolean } | null`。

3. SSE 事件循环里处理 `done` 事件的位置（现有代码在收到 `done` 后收尾），加一行 `notifyUsageChanged()`。
4. 输入区：发送按钮与 textarea 的 `disabled` 追加 `|| budgetExhausted !== null`；在输入框上方渲染提示条：

```tsx
              {budgetExhausted ? (
                <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span>{budgetExhausted.message}</span>
                  {budgetExhausted.upgradeAvailable ? (
                    <Link href="/pricing" className="shrink-0 font-medium text-brand-600 hover:text-brand-500">
                      升级
                    </Link>
                  ) : null}
                </div>
              ) : null}
```

import：`import { notifyUsageChanged } from '@/hooks/useUsage'`；若文件里没有 `Link`，加 `import Link from 'next/link'`。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npx vitest run tests/billing`
Expected: 无类型错误。手工检查（`npm run dev` 用 3457 端口，不要用 3001）：侧栏底部出现用量表；接口 404 时侧栏不出现用量表且输入可用。

---

### Task C5: TransitConnector 与 DayCards 的免费档提示

**Files:**
- Modify: `app/(authed)/plan/[id]/components/TransitConnector.tsx`
- Modify: `app/(authed)/plan/[id]/components/DayCards.tsx`
- Test: `tests/billing/tierHints.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/billing/tierHints.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierHint } from '@/components/billing/TierHint'

describe('TierHint', () => {
  it('renders the transit hint with a pricing link', () => {
    render(<TierHint kind="transit" />)
    expect(screen.getByText(/升级后可查看真实路线/)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing')
  })
  it('renders the restaurant placeholder', () => {
    render(<TierHint kind="restaurant" />)
    expect(screen.getByText(/升级后可推荐餐厅/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/billing/tierHints.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现共用提示组件**

```tsx
// components/billing/TierHint.tsx
import Link from 'next/link'
import { Lock } from 'lucide-react'

const TEXT = {
  transit: '升级后可查看真实路线与耗时',
  restaurant: '升级后可推荐餐厅',
} as const

/** 免费档唯一允许出现的两处档位差异提示（设计 §4） */
export function TierHint(props: { kind: keyof typeof TEXT }) {
  return (
    <Link
      href="/pricing"
      className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-100"
    >
      <Lock className="h-3 w-3" aria-hidden />
      {TEXT[props.kind]}
    </Link>
  )
}
```

- [ ] **Step 4: 接入 TransitConnector**

`TransitConnector` 新增可选 prop `showEstimateUpgradeHint?: boolean`。在折叠摘要行里，当 `isEstimate && props.showEstimateUpgradeHint` 时，在摘要文字后追加 `<TierHint kind="transit" />`。调用方（`DayCards.tsx` 里 `item.type === 'transit'` 的分支）传入 `showEstimateUpgradeHint={usage?.hints.transitEstimateOnly ?? false}`。

- [ ] **Step 5: 接入 DayCards**

`DayCards` 组件内 `const { usage } = useUsage()`。渲染 meal 条目（`item.type === 'meal'`）且该条目没有 `payload.place`（用现有 `itemPayload.ts` 里的读取助手判断）时，在条目标题下方渲染 `<TierHint kind="restaurant" />`，条件是 `usage?.hints.restaurantsLocked`。`DayCards` 是列表组件，`useUsage` 只在它顶层调用一次并向下传值，不要在每个条目里调用。

- [ ] **Step 6: 验证**

Run: `npx vitest run tests/billing && npm run typecheck`
Expected: PASS。

---

### Task C6: 账户页与定价页

**Files:**
- Modify: `app/(authed)/me/page.tsx`
- Create: `app/(site)/pricing/page.tsx`
- Create: `components/billing/UsageMeterClient.tsx`

- [ ] **Step 1: 账户页**

`app/(authed)/me/page.tsx` 是服务端组件。新建客户端包装：

```tsx
// components/billing/UsageMeterClient.tsx
'use client'

import { useUsage } from '@/hooks/useUsage'
import { UsageMeter } from './UsageMeter'

export function UsageMeterClient(props: { size: 'compact' | 'full' }) {
  const { usage } = useUsage()
  return <UsageMeter usage={usage} size={props.size} />
}
```

在 `MePage` 的 SECTIONS 列表上方渲染 `<UsageMeterClient size="full" />`（外层留 `mb-6`）。

- [ ] **Step 2: 定价页**

```tsx
// app/(site)/pricing/page.tsx
import Link from 'next/link'
import { Check, Minus } from 'lucide-react'

export const metadata = { title: '套餐 · SeichiGo' }

type Row = { label: string; free: string | boolean; standard: string | boolean; pro: string | boolean }

const ROWS: Row[] = [
  { label: 'AI 巡礼规划、追问与重生成', free: true, standard: true, pro: true },
  { label: '点位、封面与日程排布', free: true, standard: true, pro: true },
  { label: '地点解析与照片', free: true, standard: true, pro: true },
  { label: '餐厅推荐', free: false, standard: true, pro: true },
  { label: '交通信息', free: '参考估算', standard: '真实路线', pro: '真实路线 + 日本公交（即将上线）' },
  { label: '酒店与航班建议', free: false, standard: false, pro: '即将上线' },
  { label: '更多模型可选', free: false, standard: false, pro: '即将上线' },
  { label: '单个行程天数', free: '最多 3 天', standard: '最多 7 天', pro: '最多 14 天' },
  { label: '每月 agent 用量', free: '体验额度', standard: '标准额度', pro: '大额度' },
]

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-brand-600" aria-label="包含" />
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-gray-300" aria-label="不包含" />
  return <span className="text-sm text-gray-700">{value}</span>
}

const TIERS = [
  { key: 'free', name: '免费', price: '¥0', period: '', cta: { label: '当前可用', href: '/plan', disabled: false, primary: false } },
  { key: 'standard', name: '标准', price: '¥—', period: '/月', cta: { label: '开通标准版', href: '/plan?upgrade=standard', disabled: false, primary: true } },
  { key: 'pro', name: '高级', price: '即将开放', period: '', cta: { label: '即将开放', href: '#', disabled: true, primary: false } },
] as const

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">选择你的巡礼规划套餐</h1>
      <p className="mt-2 text-sm text-gray-500">按月订阅，用量每月恢复。用量以百分比显示在 Plan 页与账户页。</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <section
            key={t.key}
            className={`rounded-2xl border p-5 ${t.cta.primary ? 'border-brand-300 bg-brand-50/40 shadow-sm' : 'border-pink-100 bg-white'} ${t.cta.disabled ? 'opacity-70' : ''}`}
          >
            <h2 className="text-lg font-semibold text-gray-900">{t.name}</h2>
            <p className="mt-2 text-2xl font-bold text-gray-900">
              {t.price}
              <span className="text-sm font-normal text-gray-400">{t.period}</span>
            </p>
            {t.cta.disabled ? (
              <button type="button" disabled className="mt-4 w-full cursor-not-allowed rounded-full bg-gray-200 px-4 py-2 text-sm font-medium text-gray-500">
                {t.cta.label}
              </button>
            ) : (
              <Link
                href={t.cta.href}
                className={`mt-4 block w-full rounded-full px-4 py-2 text-center text-sm font-medium ${t.cta.primary ? 'bg-brand-600 text-white hover:bg-brand-500' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                {t.cta.label}
              </Link>
            )}
          </section>
        ))}
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-pink-100 text-sm text-gray-500">
              <th className="py-2 pr-4 font-medium">功能</th>
              <th className="py-2 text-center font-medium">免费</th>
              <th className="py-2 text-center font-medium">标准</th>
              <th className="py-2 text-center font-medium">高级</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-b border-pink-50">
                <td className="py-3 pr-4 text-sm text-gray-800">{row.label}</td>
                <td className="py-3 text-center"><Cell value={row.free} /></td>
                <td className="py-3 text-center"><Cell value={row.standard} /></td>
                <td className="py-3 text-center"><Cell value={row.pro} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-xs text-gray-400">标准版价格与开通入口将在支付上线后开放；在此之前“开通标准版”仅跳转到规划页。</p>
    </main>
  )
}
```

说明：标准档价格显示 `¥—`，支付子项目上线时再填；不要写任何具体金额。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npx vitest run tests/billing`
Expected: 通过。手工：访问 `/pricing` 三张卡片正常，高级档按钮不可点。

---

## 自查清单（执行者完成后）

- 页面任何位置搜索不到 “credit”、“token”、“成本”、“调用” 字样。
- `/api/me/usage` 返回 404 时：侧栏与账户页不显示用量表，Plan 页输入正常，无控制台报错。
- 402 后输入禁用、提示条出现、用量表刷新；发起下一轮前刷新页面能恢复到接口给的真实状态。
- 免费档 hints 为 true 时：估算交通行有“升级后可查看真实路线”，无餐厅的用餐条目有“升级后可推荐餐厅”；标准档两者都不出现。
- 未改动 `lib/**`、`app/api/**`、`prisma/**`。
