"use client"

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import TocPanel from './TocPanel'
import TocDrawer from './TocDrawer'
import type { TocHeading } from './types'

type Props = {
  editor: Editor | null
}

type HeadingSnapshot = {
  id: string
  text: string
  level: number
  pos: number
}

type HeadingNode = {
  type: { name: string }
  textContent: string
  attrs: { level?: number }
}

function hashHeadingText(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function buildHeadingId(text: string, index: number): string {
  const normalized = text.trim().toLowerCase() || 'heading'
  return `toc-${hashHeadingText(normalized)}-${index}`
}

function extractHeadings(editor: Editor): HeadingSnapshot[] {
  const items: HeadingSnapshot[] = []
  let index = 0

  editor.state.doc.descendants((node, pos) => {
    const headingNode = node as HeadingNode
    if (headingNode.type.name !== 'heading') return
    const text = headingNode.textContent || ''
    const level = Number(headingNode.attrs.level) || 1
    const id = buildHeadingId(text, index)
    items.push({ id, text, level, pos })
    index += 1
  })

  return items
}

function resolveActiveId(headings: TocHeading[], from: number): string | null {
  let currentHeadingId: string | null = null

  for (const heading of headings) {
    if (typeof heading.pos !== 'number') continue
    if (heading.pos <= from) {
      currentHeadingId = heading.id
    } else {
      break
    }
  }

  return currentHeadingId
}

export default function EditorToc({ editor }: Props) {
  const [headings, setHeadings] = useState<TocHeading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const headingsRef = useRef<TocHeading[]>([])

  useEffect(() => {
    if (!editor) return

    const updateHeadings = () => {
      const nextHeadings = extractHeadings(editor)
      headingsRef.current = nextHeadings
      setHeadings(nextHeadings)
      setActiveId(resolveActiveId(nextHeadings, editor.state.selection.from))
    }

    const updateSelection = () => {
      if (!editor) return
      const list = headingsRef.current.length ? headingsRef.current : extractHeadings(editor)
      setActiveId(resolveActiveId(list, editor.state.selection.from))
    }

    updateHeadings()

    const handleTransaction = () => {
      updateHeadings()
    }

    editor.on('transaction', handleTransaction)
    editor.on('selectionUpdate', updateSelection)

    return () => {
      editor.off('transaction', handleTransaction)
      editor.off('selectionUpdate', updateSelection)
    }
  }, [editor])

  const handleHeadingClick = (h: TocHeading) => {
    if (!editor || typeof h.pos !== 'number') return
    editor.chain().focus().setTextSelection(h.pos).run()
    editor.commands.scrollIntoView()
    try {
      const domAt = editor.view.domAtPos(h.pos)
      const base = domAt.node.nodeType === Node.TEXT_NODE ? domAt.node.parentElement : (domAt.node as HTMLElement)
      if (base instanceof HTMLElement) {
        base.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    } catch {}
  }

  if (headings.length === 0) return null

  return (
    <>
      <div
        className={`hidden lg:flex flex-col sticky top-24 transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed ? 'w-8' : 'w-64'
        }`}
      >
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} mb-3 h-6 shrink-0`}>
          {!isCollapsed && (
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider whitespace-nowrap">
              目录
            </h3>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-0.5 rounded text-gray-400 hover:text-pink-600 hover:bg-pink-50 transition-colors"
            title={isCollapsed ? '展开目录' : '收起目录'}
            aria-label={isCollapsed ? '展开目录' : '收起目录'}
          >
            {isCollapsed ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        <div
          className={`overflow-y-auto max-h-[calc(100vh-8rem)] pr-2 transition-opacity duration-200 min-w-[16rem] ${
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <TocPanel headings={headings} activeId={activeId} onHeadingClick={handleHeadingClick} />
        </div>
      </div>

      <div className="fixed bottom-6 right-6 z-40 lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg border border-gray-200 active:scale-95 transition-transform"
          aria-label="打开目录"
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      <TocDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        headings={headings}
        activeId={activeId}
        onHeadingClick={handleHeadingClick}
      />
    </>
  )
}
