'use client'

import { useSession } from 'next-auth/react'
import { useState, useEffect } from 'react'
import CommentForm from './CommentForm'
import CommentList from './CommentList'

type Props = {
  articleId?: string
  mdxSlug?: string
}

export default function CommentSection({ articleId, mdxSlug }: Props) {
  const { data: session, status } = useSession()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    fetchComments()
  }, [articleId, mdxSlug])
  
  async function fetchComments() {
    const params = new URLSearchParams()
    if (articleId) params.set('articleId', articleId)
    if (mdxSlug) params.set('mdxSlug', mdxSlug)
    
    const res = await fetch(`/api/comments?${params}`)
    const data = await res.json()
    if (data.ok) setComments(data.comments)
    setLoading(false)
  }
  
  async function handleCreate(content: string, parentId?: string) {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articleId, mdxSlug, parentId, content })
    })
    
    if (res.ok) {
      await fetchComments()
      return true
    }
    return false
  }
  
  if (loading) return <div>加载中...</div>
  
  return (
    <div className="mt-12">
      <h2 className="text-2xl font-bold mb-6">评论</h2>
      
      {status === 'unauthenticated' ? (
        <p className="text-gray-600">请先登录后评论</p>
      ) : (
        <CommentForm onSubmit={(content) => handleCreate(content)} />
      )}
      
      <CommentList 
        comments={comments} 
        onReply={handleCreate}
        onDelete={fetchComments}
        currentUserId={session?.user?.id}
        isAdmin={(session?.user as any)?.role === 'ADMIN'}
      />
    </div>
  )
}
