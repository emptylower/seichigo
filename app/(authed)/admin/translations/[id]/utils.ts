export const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
}

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  article: '文章',
  city: '城市',
  anime: '动漫',
  anitabi_bangumi: '地图作品',
  anitabi_point: '地图地标',
}

export const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  ready: '待审核',
  approved: '已上架',
  failed: '失败',
}

export function isTipTapContent(content: any) {
  return content && typeof content === 'object' && content.type === 'doc'
}

export function getContentJson(content: any) {
  if (!content) return null
  if (content.type === 'doc') return content
  if (content.contentJson && content.contentJson.type === 'doc') return content.contentJson
  return null
}

export function hasEditableContent(content: any) {
  return getContentJson(content) !== null
}
