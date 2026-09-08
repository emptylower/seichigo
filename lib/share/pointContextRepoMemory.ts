import type { SupportedLocale } from '@/lib/i18n/types'
import type {
  PointAddressRow,
  PointContextRepo,
  PointContextRow,
  SaveAddressInput,
} from '@/lib/share/pointContextRepo'

/** handler 单测用的内存实现；tests/setup.ts 把 @/lib/db/prisma 桩掉了，单测不能碰 Prisma 实现 */
export class MemoryPointContextRepo implements PointContextRepo {
  private readonly points = new Map<string, PointContextRow>()
  private readonly addresses = new Map<string, PointAddressRow>()

  constructor(rows: readonly PointContextRow[] = []) {
    for (const row of rows) this.points.set(row.pointId, { ...row })
  }

  async findPoint(pointId: string, _locale: SupportedLocale): Promise<PointContextRow | null> {
    const found = this.points.get(pointId)
    return found ? { ...found, bangumiTitleCandidates: [...found.bangumiTitleCandidates] } : null
  }

  async findAddress(pointId: string): Promise<PointAddressRow | null> {
    const found = this.addresses.get(pointId)
    return found ? { ...found } : null
  }

  async saveAddress(input: SaveAddressInput): Promise<void> {
    this.addresses.set(input.pointId, {
      pointId: input.pointId,
      addressZh: input.addressZh,
      addressEn: input.addressEn,
      addressJa: input.addressJa,
    })
  }
}
