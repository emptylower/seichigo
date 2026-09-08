import type {
  CreateShareLinkInput,
  FindRecentDuplicateInput,
  ShareLinkRecord,
  ShareLinkRepo,
} from '@/lib/share/repo'

/** handler 单测用的内存实现，行为对齐 PrismaShareLinkRepo（含 code 唯一键 P2002） */
export class MemoryShareLinkRepo implements ShareLinkRepo {
  private readonly rows = new Map<string, ShareLinkRecord>()
  private seq = 0

  constructor(private readonly now: () => Date = () => new Date()) {}

  async create(input: CreateShareLinkInput): Promise<ShareLinkRecord> {
    if (this.rows.has(input.code)) {
      throw Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
        code: 'P2002',
      })
    }
    this.seq += 1
    const record: ShareLinkRecord = {
      id: `share_${this.seq}`,
      code: input.code,
      kind: 'point',
      pointId: input.pointId,
      bangumiId: input.bangumiId,
      locale: input.locale,
      layout: input.layout,
      imageKey: null,
      userId: input.userId,
      ipHash: input.ipHash,
      clicks: 0,
      uploadCount: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
    }
    this.rows.set(record.code, record)
    return { ...record }
  }

  async findByCode(code: string): Promise<ShareLinkRecord | null> {
    const found = this.rows.get(code)
    return found ? { ...found } : null
  }

  async findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null> {
    for (const row of this.rows.values()) {
      if (row.pointId !== input.pointId) continue
      if (row.locale !== input.locale) continue
      if (row.layout !== input.layout) continue
      if ((row.userId ?? null) !== (input.userId ?? null)) continue
      if (input.userId === null && (row.ipHash ?? null) !== (input.ipHash ?? null)) continue
      if (row.createdAt.getTime() < input.since.getTime()) continue
      return { ...row }
    }
    return null
  }

  async countByIpHashSince(ipHash: string, since: Date): Promise<number> {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.ipHash !== ipHash) continue
      if (row.createdAt.getTime() < since.getTime()) continue
      count += 1
    }
    return count
  }

  async countUploadsByUserSince(userId: string, since: Date): Promise<number> {
    let sum = 0
    for (const row of this.rows.values()) {
      if (row.userId !== userId) continue
      if (row.updatedAt.getTime() < since.getTime()) continue
      sum += row.uploadCount
    }
    return sum
  }

  async markUploaded(
    code: string,
    input: { imageKey: string | null; userId: string },
  ): Promise<ShareLinkRecord | null> {
    const found = this.rows.get(code)
    if (!found) return null
    if (input.imageKey !== null) found.imageKey = input.imageKey
    found.userId = input.userId
    found.uploadCount += 1
    found.updatedAt = this.now()
    return { ...found }
  }

  async incrementClicks(code: string): Promise<void> {
    const found = this.rows.get(code)
    if (!found) return
    found.clicks += 1
  }
}
