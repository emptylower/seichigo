"use client"

import { useEffect, useRef, useState } from 'react'
import { EditorContent, type Editor, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { BlockLayout, type BlockAlign } from '@/components/editor/extensions/BlockLayout'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { TextColor } from '@/components/editor/extensions/TextColor'
import { FigureImage } from '@/components/editor/extensions/FigureImage'
import { InlineCode } from '@/components/editor/extensions/InlineCode'
import { SeichiRoute } from '@/components/editor/extensions/SeichiRoute'
import { SeichiCallout } from '@/components/editor/extensions/SeichiCallout'
import { BubbleToolbar } from '@/components/editor/richtext/BubbleToolbar'
import {
  compressImageIfNeeded,
  createVirtualElementFromDom,
  formatBytes,
  isValidHref,
  loadImageFromFile,
  normalizeHref,
  normalizePastedHttpUrl,
  resolveActiveFigureImageFromState,
  resolveClientAssetMaxBytes,
  resolveImageInsertPos,
  safeHasFocus,
} from '@/components/editor/richtext/utils'

export type RichTextValue = {
  json: unknown | null
  html: string
}

type Props = {
  initialValue: RichTextValue
  value: RichTextValue
  onChange: (next: RichTextValue) => void
  onEditorReady?: (editor: Editor) => void
}

type UploadResult = { id: string; url: string } | { error: string }
type LinkPreviewResult = { ok: true; imageUrl: string } | { error: string }

type BlockHandle = { top: number; pos: number; source: 'hover' | 'selection' }
type TextSelectionRange = { from: number; to: number }

export default function RichTextEditor({ initialValue, value, onChange, onEditorReady }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const blockMenuRef = useRef<HTMLDivElement | null>(null)
  const bubbleMenuRef = useRef<HTMLDivElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkEditing, setLinkEditing] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [, forceEditorRerender] = useState(0)
  const linkSelectionRef = useRef<TextSelectionRange | null>(null)
  const [blockHandle, setBlockHandle] = useState<BlockHandle | null>(null)
  const blockHandleRef = useRef<BlockHandle | null>(null)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)
  const blockMenuOpenRef = useRef(false)

  const initialContent = value.json ?? initialValue.json ?? value.html ?? initialValue.html ?? ''
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          horizontalRule: false,
          heading: { levels: [1, 2, 3] },
          code: false,
          link: {
            openOnClick: false,
            autolink: false,
            linkOnPaste: true,
          },
        }),
        InlineCode,
        TextColor,
        TextBackground,
        FigureImage,
        SeichiRoute,
        SeichiCallout,
        BlockLayout,
        Placeholder.configure({
          placeholder: '开始写作…',
        }),
      ],
      content: initialContent || '<p></p>',
      onUpdate({ editor }) {
        onChange({ json: editor.getJSON(), html: editor.getHTML() })
      },
      editorProps: {
        attributes: {
          class:
            'max-w-none min-h-[24rem] rounded-md border bg-white pr-3 pl-10 py-2 focus:outline-none',
        },
      },
    },
    []
  )

  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor)
    }
  }, [editor, onEditorReady])

  useEffect(() => {
    blockHandleRef.current = blockHandle
  }, [blockHandle])

  useEffect(() => {
    blockMenuOpenRef.current = blockMenuOpen
  }, [blockMenuOpen])

  useEffect(() => {
    if (!editor) return
    const close = () => {
      setLinkEditing(false)
      linkSelectionRef.current = null
    }
    editor.on('selectionUpdate', close)
    return () => {
      editor.off('selectionUpdate', close)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const bump = () => forceEditorRerender((v) => v + 1)
    editor.on('selectionUpdate', bump)
    editor.on('transaction', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('transaction', bump)
    }
  }, [editor])

  async function uploadImages(files: File[]) {
    setError(null)
    setUploading(true)
    try {
      const maxBytes = resolveClientAssetMaxBytes()
      const uploads: Array<{ url: string; naturalWidth: number | null; naturalHeight: number | null }> = []
      let failedCount = 0
      let firstError: string | null = null
      for (const file of files) {
        try {
          const normalized = await compressImageIfNeeded(file, maxBytes).catch((err: any) => {
            const message = String(err?.message || '').trim()
            if (message) firstError = firstError ?? message
            throw err
          })

          let candidate = normalized
          for (let attempt = 0; attempt < 2; attempt++) {
            const form = new FormData()
            form.set('file', candidate)
            const res = await fetch('/api/assets', { method: 'POST', body: form })
            if (res.status === 413 && attempt === 0) {
              // Platform rejected the payload; compress harder and retry once.
              const tighter = Math.max(1_500_000, Math.floor(maxBytes * 0.72))
              candidate = await compressImageIfNeeded(candidate, tighter)
              continue
            }

            const data = (await res.json().catch(() => ({}))) as UploadResult
            if (!res.ok || 'error' in data) {
              failedCount += 1
              if (res.status === 413) {
                firstError = firstError ?? `图片过大，请控制在 ${formatBytes(maxBytes)} 以内`
              } else if ('error' in data && data.error) {
                firstError = firstError ?? String(data.error)
              }
              break
            }

            let naturalWidth: number | null = null
            let naturalHeight: number | null = null
            try {
              const img = await loadImageFromFile(candidate)
              naturalWidth = img.naturalWidth || img.width || null
              naturalHeight = img.naturalHeight || img.height || null
            } catch {
              // Ignore probe failures and insert image without explicit dimensions.
            }

            uploads.push({
              url: data.url,
              naturalWidth,
              naturalHeight,
            })
            break
          }
        } catch {
          failedCount += 1
        }
      }

      if (!uploads.length) {
        if (failedCount) setError(firstError || '上传失败')
        return
      }
      if (editor) {
        editor
          .chain()
          .focus()
          .insertContentAt(
            resolveImageInsertPos(editor),
            uploads.map((row) => ({
              type: 'figureImage',
              attrs: {
                src: row.url,
                alt: '',
                naturalWidth: row.naturalWidth ?? undefined,
                naturalHeight: row.naturalHeight ?? undefined,
              },
            }))
          )
          .run()
      } else {
        const nextHtml = `${value.html || ''}\n${uploads
          .map((row) => `<p><img src="${row.url}" alt=""${row.naturalWidth && row.naturalHeight ? ` width="${row.naturalWidth}" height="${row.naturalHeight}"` : ''} /></p>`)
          .join('\n')}\n`
        onChange({ json: null, html: nextHtml })
      }

      if (failedCount) {
        setError(firstError ? `${firstError}（有 ${failedCount} 张上传失败，已插入其余 ${uploads.length} 张。）` : `有 ${failedCount} 张图片上传失败，已插入其余 ${uploads.length} 张。`)
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function insertLinkPreviewImage(url: string) {
    setError(null)
    setUploading(true)
    try {
      const res = await fetch('/api/link-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = (await res.json().catch(() => ({}))) as LinkPreviewResult
      if (!res.ok || 'error' in data) {
        setError(('error' in data && data.error) || '预览图获取失败')
        return
      }

      const imageUrl = String((data as any).imageUrl || '').trim()
      if (!imageUrl) {
        setError('预览图获取失败')
        return
      }

      if (editor) {
        editor.chain().focus().insertContent([{ type: 'figureImage', attrs: { src: imageUrl, alt: '' } }]).run()
      } else {
        const nextHtml = `${value.html || ''}\n<p><img src="${imageUrl}" alt="" /></p>\n`
        onChange({ json: null, html: nextHtml })
      }
    } finally {
      setUploading(false)
    }
  }

  function closeLinkEditor() {
    setLinkEditing(false)
    linkSelectionRef.current = null
  }

  function openLinkEditor() {
    if (!editor) return
    setError(null)
    linkSelectionRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }
    setLinkValue(String(editor.getAttributes('link')?.href || ''))
    setLinkEditing(true)
  }

  function unsetLink() {
    if (!editor) return
    const selection = linkSelectionRef.current
    const chain = editor.chain().focus()
    if (selection) chain.setTextSelection(selection)
    chain.extendMarkRange('link').unsetLink().run()
  }

  function applyLink() {
    if (!editor) return
    const raw = linkValue.trim()
    if (!raw) {
      unsetLink()
      closeLinkEditor()
      return
    }

    const href = normalizeHref(raw)
    if (!href || !isValidHref(href)) {
      setError('链接格式不合法（仅允许 http/https/mailto 或站内相对路径）。')
      return
    }

    const selection = linkSelectionRef.current
    const chain = editor.chain().focus()
    if (selection) chain.setTextSelection(selection)
    chain.extendMarkRange('link').setLink({ href }).run()
    closeLinkEditor()
  }

  function focusAt(pos: number) {
    if (!editor) return
    editor.chain().focus().setTextSelection(pos).run()
  }

  function getActiveBlockLabel(): string {
    if (!editor) return '正文'
    if (editor.isActive('heading', { level: 1 })) return 'H1 一级标题'
    if (editor.isActive('heading', { level: 2 })) return 'H2 二级标题'
    if (editor.isActive('heading', { level: 3 })) return 'H3 三级标题'
    if (editor.isActive('bulletList')) return '无序列表'
    if (editor.isActive('orderedList')) return '有序列表'
    if (editor.isActive('blockquote')) return '引用'
    if (editor.isActive('codeBlock')) return '代码块'
    if (editor.isActive('figureImage')) return '图片'
    return '正文'
  }

  function getActiveAlign(): BlockAlign {
    if (!editor) return 'left'
    const { $from } = editor.state.selection
    if ($from.depth < 1) return 'left'
    const node = $from.node(1)
    const raw = String((node.attrs as any)?.align || '')
    if (raw === 'center' || raw === 'right') return raw
    return 'left'
  }

  function computeHandleFromDom(el: HTMLElement, source: BlockHandle['source']): BlockHandle | null {
    if (!editor || !wrapperRef.current) return null

    const wrapperRect = wrapperRef.current.getBoundingClientRect()
    const rect = el.getBoundingClientRect()

    let pos: number | null = null
    try {
      pos = editor.view.posAtDOM(el, 0)
    } catch {
      pos = null
    }
    if (pos == null) {
      const r = editor.view.posAtCoords({ left: rect.left + 12, top: rect.top + Math.min(8, rect.height / 2) })
      pos = r?.pos ?? null
    }
    if (pos == null) return null

    return {
      source,
      pos,
      top: Math.max(8, rect.top - wrapperRect.top + 2),
    }
  }

  function updateSelectionHandle() {
    if (!editor || !wrapperRef.current) return
    if (!editor.isEditable) return
    if (!safeHasFocus(editor)) return
    if (editor.state.selection.empty && !blockMenuOpenRef.current) {
      if (blockHandleRef.current?.source === 'selection') setBlockHandle(null)
      return
    }

    const { from } = editor.state.selection
    const domAt = editor.view.domAtPos(from)
    const base = domAt.node.nodeType === Node.TEXT_NODE ? (domAt.node.parentElement as HTMLElement | null) : (domAt.node as HTMLElement | null)
    const block = base?.closest?.('p, h1, h2, h3, blockquote, pre, figure, img, li') as HTMLElement | null
    if (!block) return

    const next = computeHandleFromDom(block, 'selection')
    if (!next) return
    setBlockHandle(next)
  }

  function updateHoverHandle(target: EventTarget | null, clientX: number) {
    if (!editor || !wrapperRef.current) return
    if (!editor.isEditable) return
    if (blockMenuOpen) return
    if (!target || !(target instanceof HTMLElement)) return

    const wrapperRect = wrapperRef.current.getBoundingClientRect()
    const inGutter = clientX <= wrapperRect.left + 56
    if (!inGutter) {
      if (blockHandleRef.current?.source === 'hover') setBlockHandle(null)
      return
    }

    const block = target.closest('p, h1, h2, h3, blockquote, pre, figure, img, li') as HTMLElement | null
    if (!block) return

    const next = computeHandleFromDom(block, 'hover')
    if (!next) return
    setBlockHandle(next)
  }

  function toggleBlockMenu() {
    const h = blockHandleRef.current
    if (!editor || !h) return
    if (blockMenuOpen) {
      setBlockMenuOpen(false)
      return
    }
    focusAt(h.pos)
    setBlockMenuOpen(true)
  }

  useEffect(() => {
    if (!editor) return
    const onBlur = () => {
      setBlockMenuOpen(false)
      setTimeout(() => {
        if (!safeHasFocus(editor)) setBlockHandle(null)
      }, 0)
    }
    editor.on('blur', onBlur)
    editor.on('focus', updateSelectionHandle)
    editor.on('selectionUpdate', updateSelectionHandle)
    return () => {
      editor.off('blur', onBlur)
      editor.off('focus', updateSelectionHandle)
      editor.off('selectionUpdate', updateSelectionHandle)
    }
  }, [editor])

  useEffect(() => {
    if (!blockMenuOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBlockMenuOpen(false)
        setLinkEditing(false)
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (blockMenuRef.current?.contains(t)) return
      if (wrapperRef.current?.contains(t)) {
        // Clicked inside editor; let user change selection, but close block menu.
        setBlockMenuOpen(false)
        return
      }
      setBlockMenuOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [blockMenuOpen])

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <div ref={wrapperRef} className="relative">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadImages([f])
          }}
        />

        {editor ? (
          <>
            <BubbleMenu
              editor={editor}
              options={{ placement: 'top', offset: 8 }}
              getReferencedVirtualElement={() => {
                try {
                  if (!editor) return null
                  const active = resolveActiveFigureImageFromState(editor.state)
                  if (!active?.pos && active?.pos !== 0) return null
                  if (active.pos == null) return null
                  const dom = editor.view.nodeDOM(active.pos) as HTMLElement | null
                  if (!dom) return null
                  const frame = dom.querySelector('[data-figure-image-frame]') || dom.querySelector('img')
                  return createVirtualElementFromDom(frame)
                } catch {
                  return null
                }
              }}
              shouldShow={({ editor, state }) => {
                try {
                  if (!editor.isEditable) return false
                  const menuHasFocus = bubbleMenuRef.current?.contains(document.activeElement) ?? false
                  if (!safeHasFocus(editor) && !menuHasFocus) return false
                  if (!state.selection.empty) return true
                  return linkEditing || editor.isActive('figureImage')
                } catch {
                  return false
                }
              }}
            >
              <div ref={bubbleMenuRef}>
                <BubbleToolbar
                  editor={editor}
                  linkEditing={linkEditing}
                  linkValue={linkValue}
                  setLinkValue={setLinkValue}
                  applyLink={applyLink}
                  unsetLink={unsetLink}
                  closeLinkEditor={closeLinkEditor}
                  openLinkEditor={openLinkEditor}
                  uploading={uploading}
                  onPickImage={() => fileRef.current?.click()}
                  getActiveBlockLabel={getActiveBlockLabel}
                  getActiveAlign={getActiveAlign}
                />
              </div>
            </BubbleMenu>

            {blockHandle ? (
              <div className="absolute left-2 z-20" style={{ top: blockHandle.top }}>
                <button
                  type="button"
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-gray-500 transition-colors',
                    'hover:border-gray-200 hover:bg-gray-100 hover:text-gray-700',
                    blockMenuOpen ? 'border-gray-200 bg-gray-100 text-gray-700' : '',
                  ].join(' ')}
                  aria-label="段落菜单"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleBlockMenu}
                >
                  <span className="text-sm leading-none">⋮⋮</span>
                </button>
              </div>
            ) : null}

            {blockMenuOpen && blockHandle ? (
              <div
                ref={blockMenuRef}
                className="absolute left-10 z-30"
                style={{ top: Math.max(6, blockHandle.top - 4) }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <BubbleToolbar
                  editor={editor}
                  linkEditing={linkEditing}
                  linkValue={linkValue}
                  setLinkValue={setLinkValue}
                  applyLink={applyLink}
                  unsetLink={unsetLink}
                  closeLinkEditor={closeLinkEditor}
                  openLinkEditor={openLinkEditor}
                  uploading={uploading}
                  onPickImage={() => fileRef.current?.click()}
                  getActiveBlockLabel={getActiveBlockLabel}
                  getActiveAlign={getActiveAlign}
                />
              </div>
            ) : null}

            <div
              onMouseMove={(e) => {
                if (!editor) return
                updateHoverHandle(e.target as HTMLElement, e.clientX)
              }}
              onMouseLeave={() => {
                if (blockMenuOpen) return
                if (safeHasFocus(editor)) updateSelectionHandle()
                else setBlockHandle(null)
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files || []).filter((f) => String(f?.type || '').startsWith('image/'))
                if (files.length) {
                  e.preventDefault()
                  void uploadImages(files)
                  return
                }

                const text = String(e.clipboardData?.getData('text/plain') || '')
                const url = normalizePastedHttpUrl(text)
                if (!url) return

                e.preventDefault()
                void insertLinkPreviewImage(url)
              }}
            >
              <EditorContent editor={editor} />
            </div>
          </>
        ) : (
          <div className="rounded-md border bg-white px-3 py-2 text-sm text-gray-500">编辑器加载中…</div>
        )}        
      </div>
    </div>
  )
}
