import type { SupportedLocale } from '@/lib/i18n/types'
import type { ShareCardLayout } from '@/lib/share/types'

export type ShareLinkRecord = {
  id: string
  code: string
  kind: string
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
  imageKey: string | null
  userId: string | null
  ipHash: string | null
  clicks: number
  createdAt: Date
}

export type CreateShareLinkInput = {
  code: string
  pointId: string
  bangumiId: number
  locale: SupportedLocale
  layout: ShareCardLayout
  userId: string | null
  ipHash: string | null
}

export type FindRecentDuplicateInput = {
  pointId: string
  locale: SupportedLocale
  layout: ShareCardLayout
  userId: string | null
  /** 匿名（userId 为 null）时的第二把去重键，避免不同访客互相吃到同一条短链 */
  ipHash: string | null
  since: Date
}

export interface ShareLinkRepo {
  create(input: CreateShareLinkInput): Promise<ShareLinkRecord>
  findByCode(code: string): Promise<ShareLinkRecord | null>
  /** 24 小时窗口内同 (pointId, locale, layout, userId[, ipHash]) 的既有记录 */
  findRecentDuplicate(input: FindRecentDuplicateInput): Promise<ShareLinkRecord | null>
  countByIpHashSince(ipHash: string, since: Date): Promise<number>
  /** 只数 imageKey 非空的记录：配额算的是「上传」而不是「建链」 */
  countUploadsByUserSince(userId: string, since: Date): Promise<number>
  markUploaded(
    code: string,
    input: { imageKey: string; userId: string },
  ): Promise<ShareLinkRecord | null>
  incrementClicks(code: string): Promise<void>
}
