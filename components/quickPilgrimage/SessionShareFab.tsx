'use client'

import { Share2 } from 'lucide-react'

type SessionShareFabProps = {
  count: number
  onClick: () => void
}

export default function SessionShareFab({ count, onClick }: SessionShareFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-[160] inline-flex items-center gap-2 rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-xl shadow-brand-500/30 hover:bg-brand-600"
    >
      <Share2 size={16} />
      分享本次行程
      <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{count}</span>
    </button>
  )
}
