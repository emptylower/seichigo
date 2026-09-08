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
  /** 每次 markUploaded 原子 +1；同一短链反复上传也计次 */
  uploadCount: number
  createdAt: Date
  /** 最近一次上传时间（未上传过时等于建链时间） */
  updatedAt: Date
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
  /** 配额按次数算：sum(uploadCount) where userId 且 updatedAt 在窗口内 */
  countUploadsByUserSince(userId: string, since: Date): Promise<number>
  /**
   * 回填 imageKey/userId 并原子自增 uploadCount、刷新 updatedAt。
   * imageKey 传 null 表示这次只传了实拍：不动 imageKey，只计配额。
   */
  markUploaded(
    code: string,
    input: { imageKey: string | null; userId: string },
  ): Promise<ShareLinkRecord | null>
  incrementClicks(code: string): Promise<void>
}
