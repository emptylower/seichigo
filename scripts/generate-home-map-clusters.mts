/**
 * 生成首页地图预览的网格聚合 + 城市名标签（第十二轮 A3，§0 契约；审查修复中-12/低-4/低-5）。
 *
 *   npx tsx scripts/generate-home-map-clusters.mts [--out content/generated/home-map-clusters.json]
 *
 * 只读生产库（.env.local 的 DATABASE_URL）：游标分页流式读全部带坐标的
 * AnitabiPoint（纯生成器在 homeMapClustersScript.ts，可单测），内存按 0.1°
 * 网格聚合计数，输出 { generatedAt, totalPoints, cells, labels }（cells 按
 * count 降序最多 MAX_CELLS 个；labels 为城市名标签，最多 8 条按 count 降序），
 * 紧凑 JSON 落盘并断言 ≤ 50 KB。
 *
 * 城市坐标口径（生产库实测：City 表无坐标字段、AnitabiMapping.cityId 全空、
 * AnitabiPoint 无 cityName）：按 AnitabiBangumi.city 的有效城市名分组，城市
 * 坐标 = 组内全部点位的逐维中位数；三语名经 normalizeCityName 后精确匹配
 * CityAlias.aliasNorm 取 City 三语字段，缺失回退 zh。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnvLocal, flagValue } from './homeEnv'
import {
  aggregateCells,
  parseHomeMapClusters,
  pickCityLabels,
  type CityLabelCandidate,
} from '@/lib/home/mapClusters'
import {
  CELL_DEG,
  MAX_CELLS,
  PAGE_SIZE,
  isInvalidCityName,
  median,
  normalizeCityName,
  streamPointCoordinates,
  trimCellsToByteBudget,
} from './homeMapClustersScript'
import { prisma } from '@/lib/db/prisma'

/** 高-3 预算：home-map-clusters.json ≤ 50 KB（形状不变，超限直接失败） */
const MAP_CLUSTERS_MAX_BYTES = 50 * 1024
/** labels（≤8 条三语名）的序列化余量：cells 裁剪先留出，落盘前仍有硬断言兜底 */
const LABEL_RESERVE_BYTES = 2 * 1024

function parseOutPath(argv: string[]): string {
  return flagValue(argv, '--out') || 'content/generated/home-map-clusters.json'
}

async function main(): Promise<void> {
  loadEnvLocal()
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (.env.local missing?)')
    process.exit(1)
  }
  const outPath = parseOutPath(process.argv.slice(2))

  // Prisma 游标分页接线：cursor=上一页最后一行 id，skip:1 跳过游标行本身
  const fetchPage = async (cursor: string | null) => {
    const rows = await prisma.anitabiPoint.findMany({
      where: { geoLat: { not: null }, geoLng: { not: null } },
      select: { id: true, geoLat: true, geoLng: true, bangumiId: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    return rows.map((row) => ({
      id: row.id,
      lat: row.geoLat,
      lng: row.geoLng,
      bangumiId: row.bangumiId,
    }))
  }

  const points: Array<{ lat: number; lng: number; bangumiId?: number }> = []
  let read = 0
  for await (const point of streamPointCoordinates(fetchPage)) {
    points.push(point)
    read += 1
    if (read % (PAGE_SIZE * 10) === 0) console.log(`[map-clusters] read ${points.length} points…`)
  }

  const allCells = aggregateCells(points, CELL_DEG, MAX_CELLS)
  const candidates = await buildCityCandidates(points)
  const serialize = (cellCount: number) =>
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalPoints: points.length,
      cells: allCells.slice(0, cellCount),
      labels: [],
    })}\n`
  // labels 计入文件预算：先按 (预算 - labels 余量) 裁 cells，labels 从裁剪后的 cells 取数
  const cells = trimCellsToByteBudget(allCells, MAP_CLUSTERS_MAX_BYTES - LABEL_RESERVE_BYTES, (list) =>
    Buffer.byteLength(serialize(list.length), 'utf8')
  )
  const labels = pickCityLabels(cells, candidates)

  const payload = {
    generatedAt: new Date().toISOString(),
    totalPoints: points.length,
    cells,
    labels,
  }
  if (!parseHomeMapClusters(payload)) {
    console.error('generated payload failed shape validation')
    process.exit(1)
  }

  const serialized = `${JSON.stringify(payload)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAP_CLUSTERS_MAX_BYTES) {
    console.error(
      `map clusters payload is ${Buffer.byteLength(serialized, 'utf8')} bytes (budget: ${MAP_CLUSTERS_MAX_BYTES}); ` +
        'reduce MAX_CELLS or cell precision'
    )
    process.exit(1)
  }

  const outFilePath = path.join(process.cwd(), outPath)
  await mkdir(path.dirname(outFilePath), { recursive: true })
  await writeFile(outFilePath, serialized, 'utf8')

  console.log(
    `[map-clusters] totalPoints=${payload.totalPoints} cells=${payload.cells.length}` +
      `${payload.cells.length < allCells.length ? ` (trimmed from ${allCells.length} by budget)` : ''} ` +
      `labels=${labels.map((label) => `${label.name.zh}:${label.count}`).join('|')} ` +
      `bytes=${Buffer.byteLength(serialized, 'utf8')} -> ${outPath}`
  )
}

/**
 * 城市候选构建：AnitabiBangumi.city 有效值 → normalize 后分组 → 组内点位逐维
 * 中位数为质心 → 短名匹配 CityAlias.aliasNorm 取 City 三语名（缺失回退 zh）。
 */
async function buildCityCandidates(
  points: Array<{ lat: number; lng: number; bangumiId?: number }>
): Promise<CityLabelCandidate[]> {
  const [cityRows, aliasRows, bangumiCityRows] = await Promise.all([
    prisma.city.findMany({
      where: { hidden: false },
      select: { id: true, slug: true, name_zh: true, name_en: true, name_ja: true },
    }),
    prisma.cityAlias.findMany({ select: { aliasNorm: true, cityId: true } }),
    prisma.anitabiBangumi.findMany({
      where: { city: { not: null } },
      select: { id: true, city: true },
    }),
  ])

  const cityByAliasNorm = new Map(
    aliasRows
      .map((alias) => ({ alias, city: cityRows.find((city) => city.id === alias.cityId) }))
      .filter((entry): entry is { alias: { aliasNorm: string }; city: (typeof cityRows)[number] } =>
        Boolean(entry.city)
      )
      .map((entry) => [entry.alias.aliasNorm, entry.city])
  )
  const cityNameByBangumiId = new Map<number, string>()
  for (const bangumi of bangumiCityRows) {
    if (!isInvalidCityName(bangumi.city)) cityNameByBangumiId.set(bangumi.id, bangumi.city!)
  }

  const groups = new Map<string, { lats: number[]; lngs: number[]; bangumiIds: Set<number> }>()
  for (const point of points) {
    const rawCity = point.bangumiId !== undefined ? cityNameByBangumiId.get(point.bangumiId) : undefined
    if (!rawCity) continue
    const key = normalizeCityName(rawCity)
    const group = groups.get(key) ?? { lats: [], lngs: [], bangumiIds: new Set<number>() }
    group.lats.push(point.lat)
    group.lngs.push(point.lng)
    if (point.bangumiId !== undefined) group.bangumiIds.add(point.bangumiId)
    groups.set(key, group)
  }

  const candidates: CityLabelCandidate[] = []
  for (const [shortName, group] of groups) {
    const city = cityByAliasNorm.get(shortName)
    const zh = city?.name_zh ?? shortName
    candidates.push({
      name: { zh, en: city?.name_en ?? zh, ja: city?.name_ja ?? zh },
      lat: median(group.lats),
      lng: median(group.lngs),
      tieKey: shortName,
      // 城市正统度：组内作品数（点位数会被单一 IP 大集群带偏，如宇治 vs 京都）
      weight: group.bangumiIds.size,
    })
  }
  return candidates
}

await main()
