"use client"

import { useRef, useState } from 'react'
import Button from '@/components/shared/Button'

export type RichTextValue = {
  json: unknown | null
  html: string
}

type Props = {
  initialValue: RichTextValue
  value: RichTextValue
  onChange: (next: RichTextValue) => void
}

type UploadResult = { id: string; url: string } | { error: string }

export default function RichTextEditor({ value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadImage(file: File) {
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/assets', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as UploadResult
      if (!res.ok || 'error' in data) {
        setError(('error' in data && data.error) || '上传失败')
        return
      }
      const url = data.url
      const nextHtml = `${value.html || ''}\n<p><img src="${url}" alt="" /></p>\n`
      onChange({ json: null, html: nextHtml })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadImage(f)
          }}
        />
        <Button type="button" variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '上传中…' : '插入图片'}
        </Button>
        <span className="text-xs text-gray-500">简化版编辑器：直接编辑 HTML（服务端会再次净化）。</span>
      </div>

      {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <textarea
        className="h-96 w-full rounded-md border bg-white px-3 py-2 font-mono text-sm"
        value={value.html || ''}
        onChange={(e) => onChange({ json: null, html: e.target.value })}
        placeholder="<p>开始写作…</p>"
      />
    </div>
  )
}

