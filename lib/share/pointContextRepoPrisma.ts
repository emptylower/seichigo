import { prisma } from '@/lib/db/prisma'
import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  PointAddressRow,
  PointContextRepo,
  PointContextRow,
  SaveAddressInput,
} from '@/lib/share/pointContextRepo'

function normalize(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

export class PrismaPointContextRepo implements PointContextRepo {
  async findPoint(pointId: string, locale: SupportedLocale): Promise<PointContextRow | null> {
    const row = await prisma.anitabiPoint.findUnique({
      where: { id: pointId },
      select: {
        id: true,
        name: true,
        mark: true,
        geoLat: true,
        geoLng: true,
        // AnitabiPoint 没有 note 列，说明来自 AnitabiPointI18n.note（同 readDetail.ts:78-82）
        i18n: {
          where: { language: locale },
          select: { name: true, note: true },
          take: 1,
        },
        bangumi: {
          select: {
            titleZh: true,
            titleJaRaw: true,
            titleOriginal: true,
            titleRomaji: true,
            titleEnglish: true,
            // 三语标题全取：去前缀要拿点位名跟任一变体比；orderBy 让行序确定
            i18n: { select: { language: true, title: true }, orderBy: { language: 'asc' } },
          },
        },
      },
    })
    if (!row) return null

    const bangumi = row.bangumi
    const localizedBangumiTitle = normalize(
      bangumi?.i18n.find((item) => item.language === locale)?.title,
    )
    const candidates = [
      ...(bangumi?.i18n.map((item) => item.title) ?? []),
      bangumi?.titleZh,
      bangumi?.titleJaRaw,
      bangumi?.titleOriginal,
      bangumi?.titleRomaji,
      bangumi?.titleEnglish,
    ]
      .map((value) => normalize(value))
      .filter((value): value is string => Boolean(value))

    return {
      pointId: row.id,
      name: row.name,
      localizedName: normalize(row.i18n[0]?.name),
      mark: normalize(row.mark),
      localizedNote: normalize(row.i18n[0]?.note),
      geoLat: row.geoLat,
      geoLng: row.geoLng,
      localizedBangumiTitle,
      bangumiTitleCandidates: Array.from(new Set(candidates)),
      bangumiTitles: {
        zh: normalize(bangumi?.titleZh),
        jaRaw: normalize(bangumi?.titleJaRaw),
        original: normalize(bangumi?.titleOriginal),
        romaji: normalize(bangumi?.titleRomaji),
        english: normalize(bangumi?.titleEnglish),
      },
    }
  }

  async findAddress(pointId: string): Promise<PointAddressRow | null> {
    const row = await prisma.anitabiPointAddress.findUnique({ where: { pointId } })
    if (!row) return null
    return {
      pointId: row.pointId,
      addressZh: row.addressZh,
      addressEn: row.addressEn,
      addressJa: row.addressJa,
    }
  }

  async saveAddress(input: SaveAddressInput): Promise<void> {
    const data = {
      addressZh: input.addressZh,
      addressEn: input.addressEn,
      addressJa: input.addressJa,
      source: input.source,
      resolvedAt: new Date(),
    }
    await prisma.anitabiPointAddress.upsert({
      where: { pointId: input.pointId },
      create: { pointId: input.pointId, ...data },
      update: data,
    })
  }

  async countResolvedSince(since: Date): Promise<number> {
    return prisma.anitabiPointAddress.count({ where: { resolvedAt: { gte: since } } })
  }
}
