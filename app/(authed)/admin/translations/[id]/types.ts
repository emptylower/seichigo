export type TranslationTask = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
  status: string
  sourceContent: any
  draftContent: any
  error?: string
  createdAt: string
}

export type HistoryItem = {
  id: string
  createdAt: string
  operatorName: string | null
  action: string
}

export type TranslationDetailProps = {
  id: string
}

export type RelatedArticle = {
  updatedAt: string
  contentJson: any
}

export type TranslatedArticle = {
  id: string
  title: string
  description: string
  seoTitle: string
  contentJson: any
  updatedAt: string
}
