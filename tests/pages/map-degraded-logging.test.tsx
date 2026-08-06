import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMapPageBootstrap: vi.fn(),
}))

vi.mock('@/lib/anitabi/feature', () => ({
  isMapReplicaEnabled: () => true,
}))

vi.mock('@/lib/anitabi/mapPageBootstrap', () => ({
  getMapPageBootstrap: mocks.getMapPageBootstrap,
}))

vi.mock('@/components/map/AnitabiMapPageLazy', () => ({
  default: () => null,
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}))

import MapPage from '@/app/(site)/map/page'

describe('map page degraded logging', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the undefined bootstrap fallback and logs the source failure', async () => {
    const reason = new Error('bootstrap unavailable')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getMapPageBootstrap.mockRejectedValue(reason)

    const page = await MapPage({ searchParams: Promise.resolve({ tab: 'hot' }) })

    expect(page.props).toMatchObject({ locale: 'zh', initialBootstrap: undefined })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[degraded:map\.bootstrap-ssr\]/),
      { locale: 'zh', tab: 'hot' },
      reason
    )
  })
})
