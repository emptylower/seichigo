import type { PrismaClient } from '@prisma/client'
import type {
  AnitabiPreloadChunkDTO,
  AnitabiPreloadChunkItemDTO,
  AnitabiPreloadChunkPointDTO,
  AnitabiPreloadManifestDTO,
} from '@/lib/anitabi/types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { clampInt, normalizeText, resolveAnitabiAssetUrl } from '@/lib/anitabi/utils'
import { toCard } from '@/lib/anitabi/readTransforms'
import {
  buildCardInclude,
  getActiveDatasetVersion,
  listAllBangumiCards,
} from '@/lib/anitabi/readCards'

const PRELOAD_CHUNK_SIZE = 200

function toPreloadPointDto(
  locale: SupportedLocale,
  row: {
    id: string
    name: string
    nameZh: string | null
    geoLat: number | null
    geoLng: number | null
    ep: string | null
    s: string | null
    image: string | null
    density: number | null
    mark: string | null
    i18n: Array<{ name: string | null; note: string | null }>
  }
): AnitabiPreloadChunkPointDTO {
  const localizedName =
    locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.name)
  const localizedNote =
    locale === 'zh' ? null : normalizeText(row.i18n?.[0]?.note)

  return {
    id: row.id,
    name: localizedName || row.name,
    nameZh: row.nameZh,
    geo:
      row.geoLat != null && row.geoLng != null ? [row.geoLat, row.geoLng] : null,
    ep: row.ep,
    s: row.s,
    image: resolveAnitabiAssetUrl(row.image),
    density: row.density,
    note: localizedNote || row.mark || null,
  }
}

export async function getPreloadManifest(input: {
  prisma: PrismaClient
  locale: SupportedLocale
}): Promise<AnitabiPreloadManifestDTO> {
  const [datasetVersion, nearbyRows, latest, recent, hot, modifiedRow] =
    await Promise.all([
      getActiveDatasetVersion(input.prisma),
      input.prisma.anitabiBangumi.findMany({
        where: { mapEnabled: true },
        include: buildCardInclude(input.locale),
        orderBy: [{ id: 'asc' }],
      }),
      listAllBangumiCards({
        prisma: input.prisma,
        locale: input.locale,
        tab: 'latest',
      }),
      listAllBangumiCards({
        prisma: input.prisma,
        locale: input.locale,
        tab: 'recent',
      }),
      listAllBangumiCards({
        prisma: input.prisma,
        locale: input.locale,
        tab: 'hot',
      }),
      input.prisma.anitabiBangumi.findFirst({
        where: { mapEnabled: true },
        orderBy: [{ sourceModifiedMs: 'desc' }, { updatedAt: 'desc' }],
        select: { sourceModifiedMs: true },
      }),
    ])

  const nearby = nearbyRows.map((row) => toCard(input.locale, row))
  const chunkCount = Math.ceil(nearby.length / PRELOAD_CHUNK_SIZE)

  return {
    datasetVersion,
    modifiedMs:
      modifiedRow?.sourceModifiedMs == null ? 0 : Number(modifiedRow.sourceModifiedMs),
    chunkSize: PRELOAD_CHUNK_SIZE,
    chunkCount,
    tabs: {
      nearby,
      latest: latest.items,
      recent: recent.items,
      hot: hot.items,
    },
  }
}

export async function listPreloadChunk(input: {
  prisma: PrismaClient
  locale: SupportedLocale
  index: number
  chunkSize?: number
}): Promise<AnitabiPreloadChunkDTO> {
  const index = clampInt(input.index, 0, 0, 9999)
  const chunkSize = clampInt(
    input.chunkSize,
    PRELOAD_CHUNK_SIZE,
    PRELOAD_CHUNK_SIZE,
    PRELOAD_CHUNK_SIZE
  )
  const skip = index * chunkSize

  const [datasetVersion, rows] = await Promise.all([
    getActiveDatasetVersion(input.prisma),
    input.prisma.anitabiBangumi.findMany({
      where: { mapEnabled: true },
      select: {
        id: true,
        sourceModifiedMs: true,
        meta: {
          select: {
            themeJson: true,
          },
        },
      },
      orderBy: [{ id: 'asc' }],
      skip,
      take: chunkSize,
    }),
  ])

  if (!rows.length) {
    return {
      datasetVersion,
      index,
      items: [],
    }
  }

  const bangumiIds = rows.map((row) => row.id)
  const pointRows = await input.prisma.anitabiPoint.findMany({
    where: { bangumiId: { in: bangumiIds } },
    include: {
      i18n: {
        where: { language: input.locale },
        select: { name: true, note: true },
        take: 1,
      },
    },
    orderBy: [{ bangumiId: 'asc' }, { ep: 'asc' }, { updatedAt: 'desc' }],
  })

  const pointsByBangumiId = new Map<number, AnitabiPreloadChunkPointDTO[]>()
  for (const row of pointRows) {
    const points = pointsByBangumiId.get(row.bangumiId) || []
    points.push(toPreloadPointDto(input.locale, row))
    pointsByBangumiId.set(row.bangumiId, points)
  }

  const items: AnitabiPreloadChunkItemDTO[] = rows.map((row) => ({
    bangumiId: row.id,
    modifiedMs: row.sourceModifiedMs == null ? 0 : Number(row.sourceModifiedMs),
    points: pointsByBangumiId.get(row.id) || [],
    theme: row.meta?.themeJson || null,
  }))

  return {
    datasetVersion,
    index,
    items,
  }
}
