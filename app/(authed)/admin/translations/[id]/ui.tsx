'use client'

import TranslationDetailView from './TranslationDetailView'
import { useTranslationDetailController } from './useTranslationDetailController'
import type { TranslationDetailProps } from './types'

export default function TranslationDetailUI(props: TranslationDetailProps) {
  const controller = useTranslationDetailController(props)
  return <TranslationDetailView controller={controller} />
}
