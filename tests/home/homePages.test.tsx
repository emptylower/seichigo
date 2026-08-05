import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChineseHomePage from '@/app/(site)/page'
import EnglishHomePage from '@/app/en/page'
import JapaneseHomePage from '@/app/ja/page'
import { getHomePortalData } from '@/lib/home/getHomePortalData'

vi.mock('@/lib/home/getHomePortalData', () => ({
  getHomePortalData: vi.fn(),
}))

describe('home page ISR failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['zh', ChineseHomePage],
    ['en', EnglishHomePage],
    ['ja', JapaneseHomePage],
  ] as const)('lets %s data failures escape instead of returning a cacheable page', async (locale, page) => {
    const failure = new Error(`${locale} home data unavailable`)
    vi.mocked(getHomePortalData).mockRejectedValueOnce(failure)

    await expect(page()).rejects.toBe(failure)
    expect(getHomePortalData).toHaveBeenCalledWith(locale)
  })
})
