export const COMMENT_REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'sexual_content',
  'copyright',
  'other',
] as const

export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number]

export const COMMENT_REPORT_REASON_LABELS: Record<CommentReportReason, string> = {
  spam: '垃圾广告或灌水',
  harassment: '骚扰或人身攻击',
  hate_speech: '仇恨或歧视内容',
  sexual_content: '色情或不适内容',
  copyright: '侵权内容',
  other: '其他违规内容',
}

export function isCommentReportReason(value: unknown): value is CommentReportReason {
  return typeof value === 'string' && COMMENT_REPORT_REASONS.includes(value as CommentReportReason)
}
