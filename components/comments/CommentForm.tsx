'use client'

import { useState } from 'react'

type Props = {
  onSubmit: (content: string) => Promise<boolean>
  placeholder?: string
  submitText?: string
}

export default function CommentForm({ onSubmit, placeholder = '写下你的评论...', submitText = '发表评论' }: Props) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) {
      setError('评论内容不能为空')
      return
    }
    
    setSubmitting(true)
    setError('')
    
    const success = await onSubmit(content)
    
    if (success) {
      setContent('')
    } else {
      setError('发表失败，请重试')
    }
    
    setSubmitting(false)
  }
  
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent"
        rows={3}
        disabled={submitting}
      />
      
      {error && <p className="text-sm text-red-600">{error}</p>}
      
      <button
        type="submit"
        disabled={submitting}
        className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-50"
      >
        {submitting ? '发表中...' : submitText}
      </button>
    </form>
  )
}
