import { unstable_cache } from 'next/cache'
import { getBootstrap } from '@/lib/anitabi/read'
import type { AnitabiMapTab } from '@/lib/anitabi/types'
import { prisma } from '@/lib/db/prisma'
import type { SupportedLocale } from '@/lib/i18n/types'

const getCachedMapPageBootstrap = unstable_cache(
  async (locale: SupportedLocale, tab: AnitabiMapTab) =>
    getBootstrap({ prisma, locale, tab }),
  ['anitabi:map-page-bootstrap'],
  { revalidate: 300 }
)

export async function getMapPageBootstrap(locale: SupportedLocale, tab: AnitabiMapTab) {
  return getCachedMapPageBootstrap(locale, tab)
}
