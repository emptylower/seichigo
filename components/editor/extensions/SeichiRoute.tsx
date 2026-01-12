"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { parseSeichiRouteEmbedV1 } from '@/lib/route/schema'
import { renderSeichiRouteEmbedHtml } from '@/lib/route/render'

type SeichiRouteAttrs = {
  id: string
  data: unknown
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    seichiRoute: {
      insertSeichiRoute: (attrs?: Partial<SeichiRouteAttrs>) => ReturnType
    }
  }
}

function generateRouteId(): string {
  try {
    const uuid = (globalThis as any)?.crypto?.randomUUID?.()
    if (typeof uuid === 'string' && uuid) return uuid
  } catch {
    // ignore
  }
  return `route_${Math.random().toString(36).slice(2, 10)}`
}

function defaultRouteData() {
  return { version: 1 as const, spots: [{ name_zh: '起点' }, { name_zh: '终点' }] }
}

function SeichiRouteView({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) {
  const id = String((node.attrs as any)?.id || '').trim()
  const data = (node.attrs as any)?.data ?? null

  useEffect(() => {
    if (id) return
    updateAttributes({ id: generateRouteId() })
  }, [id, updateAttributes])

  const parsed = useMemo(() => parseSeichiRouteEmbedV1(data), [data])
  const previewHtml = useMemo(() => {
    const safeId = id || 'route'
    if (parsed.ok) return renderSeichiRouteEmbedHtml(parsed.value, { id: safeId })
    return `<section class="seichi-route seichi-route--invalid" data-id="${safeId}">路线数据格式错误：${parsed.error}</section>`
  }, [id, parsed])

  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const lastOpenTextRef = useRef<string>('')

  useEffect(() => {
    if (!jsonOpen) return
    const next = JSON.stringify(parsed.ok ? parsed.value : defaultRouteData(), null, 2)
    lastOpenTextRef.current = next
    setJsonText(next)
    setJsonError(null)
  }, [jsonOpen, parsed])

  function openJsonEditor() {
    if (!editor?.isEditable) return
    setJsonOpen(true)
  }

  function closeJsonEditor() {
    setJsonOpen(false)
    setJsonError(null)
  }

  function saveJson() {
    const raw = jsonText.trim()
    if (!raw) {
      setJsonError('JSON 不能为空')
      return
    }
    let obj: unknown
    try {
      obj = JSON.parse(raw)
    } catch {
      setJsonError('JSON 解析失败')
      return
    }
    const next = parseSeichiRouteEmbedV1(obj)
    if (!next.ok) {
      setJsonError(next.error)
      return
    }
    updateAttributes({ data: next.value })
    setJsonOpen(false)
    setJsonError(null)
  }

  function handlePreviewClick(e: React.MouseEvent) {
    if (!editor?.isEditable) return
    e.preventDefault()
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos === 'number') {
      editor.chain().focus(undefined, { scrollIntoView: false }).setNodeSelection(pos).run()
    }
    openJsonEditor()
  }

  return (
    <NodeViewWrapper className="seichi-route-node" data-seichi-route-node="true">
      <div className="seichi-route-node__toolbar">
        <button type="button" className="seichi-route-node__btn" onClick={openJsonEditor} disabled={!editor?.isEditable}>
          编辑 JSON
        </button>
        <button
          type="button"
          className="seichi-route-node__btn"
          onClick={() => editor?.chain().focus().deleteSelection().run()}
          disabled={!editor?.isEditable}
        >
          删除
        </button>
      </div>

      <div className="seichi-route-node__preview" onClick={handlePreviewClick} dangerouslySetInnerHTML={{ __html: previewHtml }} />

      {jsonOpen ? (
        <div className="seichi-route-node__modal" role="dialog" aria-modal="true" aria-label="编辑路线 JSON">
          <div className="seichi-route-node__modal-card">
            <div className="seichi-route-node__modal-title">编辑路线 JSON</div>
            <textarea
              className="seichi-route-node__textarea"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            {jsonError ? <div className="seichi-route-node__error">{jsonError}</div> : null}
            <div className="seichi-route-node__modal-actions">
              <button type="button" className="seichi-route-node__btn" onClick={closeJsonEditor}>
                取消
              </button>
              <button type="button" className="seichi-route-node__btn seichi-route-node__btn--primary" onClick={saveJson}>
                保存
              </button>
            </div>
            {jsonText === lastOpenTextRef.current ? null : <div className="seichi-route-node__hint">提示：保存后会更新文章内容。</div>}
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  )
}

export const SeichiRoute = Node.create({
  name: 'seichiRoute',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      id: { default: '' },
      data: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'seichi-route',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false
          const id = (el.getAttribute('data-id') || '').trim()
          return { id: id || generateRouteId(), data: null }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const id = String((HTMLAttributes as any)?.id || '').trim()
    return ['seichi-route', mergeAttributes(id ? { 'data-id': id } : {})]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SeichiRouteView)
  },

  addCommands() {
    return {
      insertSeichiRoute:
        (attrs) =>
        ({ chain }) => {
          const id = typeof attrs?.id === 'string' && attrs.id.trim() ? attrs.id.trim() : generateRouteId()
          const data = attrs?.data ?? defaultRouteData()
          return chain()
            .insertContent({ type: this.name, attrs: { id, data } })
            .run()
        },
    }
  },
})
