"use client"

import SharedCoverField from '@/components/shared/CoverField'

type Props = {
  articleId: string
  apiBase?: string
  value: string | null
  disabled?: boolean
  onChange: (next: string | null) => void
  onBusyChange?: (busy: boolean) => void
}

export default function CoverField({ articleId, apiBase, value, disabled, onChange, onBusyChange }: Props) {
  async function onSave(next: string | null) {
    const base = String(apiBase || '/api/articles').replace(/\/$/, '')
    const res = await fetch(`${base}/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover: next }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = typeof (data as any)?.error === 'string' ? (data as any).error : '保存封面失败'
      throw new Error(msg)
    }
  }

  return (
    <SharedCoverField
      value={value}
      disabled={disabled}
      onChange={onChange}
      onBusyChange={onBusyChange}
      onSave={onSave}
      aspectRatio={16 / 9}
      label="封面（可选）"
      description="用于首页明信片展示，比例固定为 16:9"
    />
  )
}
