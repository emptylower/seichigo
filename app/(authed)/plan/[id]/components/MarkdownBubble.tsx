'use client'

import { useMemo } from 'react'
import { renderCommentMarkdown } from '@/lib/comment/markdown'

/**
 * assistant 聊天气泡的 markdown 渲染：复用评论域的 marked + sanitize-html 管线。
 * 用户气泡不走这里（保持纯文本，避免注入面）。
 */
export function MarkdownBubble({ text }: { text: string }) {
  const html = useMemo(() => renderCommentMarkdown(text), [text])
  return <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: html }} />
}
