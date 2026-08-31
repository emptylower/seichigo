'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CreatePlanButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/me/plans', { method: 'POST', body: JSON.stringify({}) })
      const body = (await res.json()) as { plan?: { id: string }; error?: string }
      if (!res.ok || !body.plan) {
        setError(body.error ?? '创建失败')
        return
      }
      router.push(`/plan/${body.plan.id}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
      <button
        type="button"
        onClick={create}
        disabled={pending}
        className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? '创建中…' : '新建计划'}
      </button>
    </div>
  )
}
