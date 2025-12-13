"use client"
import React from 'react'

export default function Callout({ type = 'note', children }: { type?: 'note' | 'warn' | 'tip'; children: React.ReactNode }) {
  const palette = {
    note: 'bg-pink-50 border-pink-200 text-pink-900',
    warn: 'bg-amber-50 border-amber-200 text-amber-900',
    tip: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }[type]
  return (
    <div className={`not-prose rounded-lg border p-3 ${palette}`}>
      {children}
    </div>
  )
}

