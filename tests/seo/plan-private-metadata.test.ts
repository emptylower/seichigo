import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/lib/tripPlan/api', () => ({
  getTripPlanApiDeps: vi.fn(async () => ({
    repo: {
      listPlans: vi.fn(),
      createPlan: vi.fn(),
      getPlan: vi.fn(),
      listMessages: vi.fn(),
    },
    getSession: vi.fn(),
  })),
}))

vi.mock('@/lib/i18n/getLocale', () => ({
  getLocale: vi.fn(async () => 'zh'),
}))

vi.mock('@/lib/tripPlan/view', () => ({
  toChatView: vi.fn(),
  toPlanView: vi.fn(),
}))

vi.mock('@/app/(authed)/plan/[id]/ui', () => ({
  PlanPlanner: vi.fn(() => null),
}))

import planIndexPage, { metadata as planIndexMetadata } from '@/app/(authed)/plan/page'
import planDetailPage, { metadata as planDetailMetadata } from '@/app/(authed)/plan/[id]/page'

describe('private plan pages noindex metadata', () => {
  it('keeps /plan opt out of indexing and following', () => {
    expect(planIndexMetadata.robots).toEqual({ index: false, follow: false })
  })

  it('keeps /plan/[id] opt out of indexing and following', () => {
    expect(planDetailMetadata.robots).toEqual({ index: false, follow: false })
  })

  it('still exports server components as default exports', () => {
    expect(typeof planIndexPage).toBe('function')
    expect(typeof planDetailPage).toBe('function')
  })
})
