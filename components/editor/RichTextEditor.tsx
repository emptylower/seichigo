"use client"

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { BlockLayout, type BlockAlign } from '@/components/editor/extensions/BlockLayout'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { TextColor } from '@/components/editor/extensions/TextColor'

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

type BlockHandle = { top: number; pos: number; source: 'hover' | 'selection' }

const TEXT_COLORS: Array<{ label: string; value: string | null; swatch: string }> = [
  { label: '默认', value: null, swatch: '#111827' },
  { label: '灰', value: '#9ca3af', swatch: '#9ca3af' },
  { label: '红', value: '#ef4444', swatch: '#ef4444' },
  { label: '橙', value: '#f97316', swatch: '#f97316' },
  { label: '黄', value: '#f59e0b', swatch: '#f59e0b' },
  { label: '绿', value: '#22c55e', swatch: '#22c55e' },
  { label: '蓝', value: '#3b82f6', swatch: '#3b82f6' },
  { label: '紫', value: '#8b5cf6', swatch: '#8b5cf6' },
]

const BG_COLORS: Array<{ label: string; value: string | null; swatch?: string }> = [
  { label: '无', value: null },
  { label: '白', value: '#ffffff', swatch: '#ffffff' },
  { label: '浅红', value: '#fecaca', swatch: '#fecaca' },
  { label: '浅橙', value: '#fed7aa', swatch: '#fed7aa' },
  { label: '浅黄', value: '#fef9c3', swatch: '#fef9c3' },
  { label: '浅绿', value: '#bbf7d0', swatch: '#bbf7d0' },
  { label: '浅蓝', value: '#bfdbfe', swatch: '#bfdbfe' },
  { label: '浅紫', value: '#e9d5ff', swatch: '#e9d5ff' },
  { label: '浅灰', value: '#e5e7eb', swatch: '#e5e7eb' },
  { label: '灰', value: '#9ca3af', swatch: '#9ca3af' },
  { label: '红', value: '#f87171', swatch: '#f87171' },
  { label: '橙', value: '#fb923c', swatch: '#fb923c' },
  { label: '黄', value: '#facc15', swatch: '#facc15' },
  { label: '绿', value: '#4ade80', swatch: '#4ade80' },
  { label: '蓝', value: '#60a5fa', swatch: '#60a5fa' },
  { label: '紫', value: '#c4b5fd', swatch: '#c4b5fd' },
]

function isValidHref(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//')) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  if (!schemeMatch) return false
  const scheme = schemeMatch[1]!.toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto'
}

function ToolButton({
  active,
  disabled,
  label,
  title,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100',
        disabled ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

function DropdownTrigger({
  label,
  title,
}: {
  label: string
  title?: string
}) {
  return (
    <button
      type="button"
      className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="max-w-[9rem] truncate">{label}</span>
      <span className="text-xs text-gray-500">▾</span>
    </button>
  )
}

function DropdownItem({
  active,
  label,
  onClick,
}: {
  active?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-gray-700',
        'hover:bg-gray-50',
      ].join(' ')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-gray-500">{active ? '✓' : ''}</span>
    </button>
  )
}

function BlockDropdownItem({
  active,
  icon,
  label,
  labelClassName,
  onClick,
}: {
  active?: boolean
  icon: string
  label: string
  labelClassName?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={[
        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-gray-700',
        'hover:bg-gray-50',
      ].join(' ')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-50 text-xs font-semibold text-gray-600">{icon}</span>
        <span className={['truncate', labelClassName || ''].join(' ').trim()}>{label}</span>
      </span>
      <span className="text-xs text-gray-500">{active ? '✓' : ''}</span>
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-gray-200" />
}

export default function RichTextEditor({ initialValue, value, onChange }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const blockMenuRef = useRef<HTMLDivElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkEditing, setLinkEditing] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [blockHandle, setBlockHandle] = useState<BlockHandle | null>(null)
  const blockHandleRef = useRef<BlockHandle | null>(null)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)
  const blockMenuOpenRef = useRef(false)

  const initialHtml = value.html || initialValue.html || ''
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          horizontalRule: false,
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        TextColor,
        TextBackground,
        Link.configure({
          openOnClick: false,
          autolink: false,
          linkOnPaste: true,
        }),
        Image.configure({
          inline: false,
          allowBase64: false,
        }),
        BlockLayout,
        Placeholder.configure({
          placeholder: '开始写作…',
        }),
      ],
      content: initialHtml || '<p></p>',
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
    blockHandleRef.current = blockHandle
  }, [blockHandle])

  useEffect(() => {
    blockMenuOpenRef.current = blockMenuOpen
  }, [blockMenuOpen])

  useEffect(() => {
    if (!editor) return
    const close = () => setLinkEditing(false)
    editor.on('selectionUpdate', close)
    return () => {
      editor.off('selectionUpdate', close)
    }
  }, [editor])

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
      if (editor) {
        editor.chain().focus().setImage({ src: url, alt: '' }).run()
      } else {
        const nextHtml = `${value.html || ''}\n<p><img src="${url}" alt="" /></p>\n`
        onChange({ json: null, html: nextHtml })
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function openLinkEditor() {
    if (!editor) return
    setError(null)
    setLinkValue(String(editor.getAttributes('link')?.href || ''))
    setLinkEditing(true)
  }

  function unsetLink() {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
  }

  function applyLink() {
    if (!editor) return
    const href = linkValue.trim()
    if (!href) {
      unsetLink()
      setLinkEditing(false)
      return
    }
    if (!isValidHref(href)) {
      setError('链接格式不合法（仅允许 http/https/mailto 或站内相对路径）。')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setLinkEditing(false)
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
    if (editor.isActive('image')) return '图片'
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
    if (!editor.view.hasFocus()) return
    if (editor.state.selection.empty && !blockMenuOpenRef.current) {
      if (blockHandleRef.current?.source === 'selection') setBlockHandle(null)
      return
    }

    const { from } = editor.state.selection
    const domAt = editor.view.domAtPos(from)
    const base = domAt.node.nodeType === Node.TEXT_NODE ? (domAt.node.parentElement as HTMLElement | null) : (domAt.node as HTMLElement | null)
    const block = base?.closest?.('p, h1, h2, h3, blockquote, pre, img, li') as HTMLElement | null
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

    const block = target.closest('p, h1, h2, h3, blockquote, pre, img, li') as HTMLElement | null
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
        if (!editor.view.hasFocus()) setBlockHandle(null)
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

  function Toolbar() {
    if (!editor) return null

    return (
      <div
        className="flex items-center rounded-xl border border-gray-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur"
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest?.('input, textarea')) return
          e.preventDefault()
        }}
      >
        {linkEditing ? (
          <div className="flex items-center gap-2">
            <input
              className="h-8 w-56 rounded-md border border-gray-200 bg-white px-2 text-sm outline-none focus:border-brand-400"
              placeholder="https://..."
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyLink()
                if (e.key === 'Escape') setLinkEditing(false)
              }}
              autoFocus
            />
            <ToolButton label="保存" onClick={applyLink} />
            <ToolButton label="移除" onClick={unsetLink} />
            <ToolButton label="取消" onClick={() => setLinkEditing(false)} />
          </div>
        ) : (
          <>
            <div className="relative">
              <div className="group relative">
                <DropdownTrigger label={getActiveBlockLabel()} title="块样式" />
                <div className="absolute left-0 top-full z-50 hidden w-60 group-hover:block">
                  <div className="pt-2">
                    <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                      <BlockDropdownItem
                        icon="T"
                        label="正文"
                        labelClassName="text-sm"
                        active={editor.isActive('paragraph')}
                        onClick={() => editor.chain().focus().setParagraph().run()}
                      />
                      <BlockDropdownItem
                        icon="H1"
                        label="一级标题"
                        labelClassName="text-base font-semibold"
                        active={editor.isActive('heading', { level: 1 })}
                        onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()}
                      />
                      <BlockDropdownItem
                        icon="H2"
                        label="二级标题"
                        labelClassName="text-sm font-semibold"
                        active={editor.isActive('heading', { level: 2 })}
                        onClick={() => editor.chain().focus().setHeading({ level: 2 }).run()}
                      />
                      <BlockDropdownItem
                        icon="H3"
                        label="三级标题"
                        labelClassName="text-sm font-medium"
                        active={editor.isActive('heading', { level: 3 })}
                        onClick={() => editor.chain().focus().setHeading({ level: 3 }).run()}
                      />
                      <div className="my-1 h-px bg-gray-100" />
                      <BlockDropdownItem
                        icon="1."
                        label="有序列表"
                        active={editor.isActive('orderedList')}
                        onClick={() => {
                          if (editor.isActive('orderedList')) return
                          editor.chain().focus().toggleOrderedList().run()
                        }}
                      />
                      <BlockDropdownItem
                        icon="•"
                        label="无序列表"
                        active={editor.isActive('bulletList')}
                        onClick={() => {
                          if (editor.isActive('bulletList')) return
                          editor.chain().focus().toggleBulletList().run()
                        }}
                      />
                      <BlockDropdownItem
                        icon="</>"
                        label="代码块"
                        active={editor.isActive('codeBlock')}
                        onClick={() => {
                          if (editor.isActive('codeBlock')) return
                          editor.chain().focus().toggleCodeBlock().run()
                        }}
                      />
                      <BlockDropdownItem
                        icon="❝"
                        label="引用"
                        active={editor.isActive('blockquote')}
                        onClick={() => {
                          if (editor.isActive('blockquote')) return
                          editor.chain().focus().toggleBlockquote().run()
                        }}
                      />
                      <div className="my-1 h-px bg-gray-100" />
                      <BlockDropdownItem icon="链" label="链接…" active={editor.isActive('link')} onClick={openLinkEditor} />
                      {editor.isActive('link') ? <BlockDropdownItem icon="链" label="移除链接" onClick={unsetLink} /> : null}
                      <BlockDropdownItem
                        icon="图"
                        label={uploading ? '上传中…' : '插入图片…'}
                        onClick={() => fileRef.current?.click()}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            <div className="relative">
              <div className="group relative">
                <DropdownTrigger label={{ left: '左对齐', center: '居中', right: '右对齐' }[getActiveAlign()]} title="对齐与缩进" />
                <div className="absolute left-0 top-full z-50 hidden w-44 group-hover:block">
                  <div className="pt-2">
                    <div className="rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                      <DropdownItem label="左对齐" active={getActiveAlign() === 'left'} onClick={() => editor.chain().focus().setBlockAlign('left').run()} />
                      <DropdownItem label="居中对齐" active={getActiveAlign() === 'center'} onClick={() => editor.chain().focus().setBlockAlign('center').run()} />
                      <DropdownItem label="右对齐" active={getActiveAlign() === 'right'} onClick={() => editor.chain().focus().setBlockAlign('right').run()} />
                      <div className="my-1 h-px bg-gray-100" />
                      <DropdownItem label="增加缩进" onClick={() => editor.chain().focus().increaseBlockIndent().run()} />
                      <DropdownItem label="减少缩进" onClick={() => editor.chain().focus().decreaseBlockIndent().run()} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            <div className="flex items-center gap-1">
              <ToolButton
                label="B"
                title="加粗"
                active={editor.isActive('bold')}
                disabled={!editor.can().chain().focus().toggleBold().run()}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <ToolButton
                label="S"
                title="删除线"
                active={editor.isActive('strike')}
                disabled={!editor.can().chain().focus().toggleStrike().run()}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <ToolButton
                label="I"
                title="斜体"
                active={editor.isActive('italic')}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <ToolButton
                label="U"
                title="下划线"
                active={editor.isActive('underline')}
                disabled={!editor.can().chain().focus().toggleUnderline().run()}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              />
              <ToolButton
                label="</>"
                title="行内代码"
                active={editor.isActive('code')}
                disabled={!editor.can().chain().focus().toggleCode().run()}
                onClick={() => editor.chain().focus().toggleCode().run()}
              />

              <div className="group relative">
                <ToolButton
                  label="A"
                  title="颜色"
                  active={Boolean(editor.getAttributes('textColor')?.color) || Boolean(editor.getAttributes('textBackground')?.backgroundColor)}
                  onClick={() => {}}
                />
                <div className="absolute right-0 top-full z-50 hidden w-80 group-hover:block" onMouseDown={(e) => e.preventDefault()}>
                  <div className="pt-2">
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                      <div className="text-xs font-medium text-gray-600">字体颜色</div>
                      <div className="mt-2 grid grid-cols-8 gap-2">
                        {TEXT_COLORS.map((c) => {
                          const active = String(editor.getAttributes('textColor')?.color || '').toLowerCase() === String(c.value || '').toLowerCase()
                          return (
                            <button
                              key={c.label}
                              type="button"
                              className={[
                                'flex h-8 w-8 items-center justify-center rounded-md border text-sm font-semibold',
                                active ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-300',
                              ].join(' ')}
                              title={c.label}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                if (c.value) editor.chain().focus().setTextColor(c.value).run()
                                else editor.chain().focus().unsetTextColor().run()
                              }}
                            >
                              <span style={{ color: c.swatch }}>A</span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="mt-4 text-xs font-medium text-gray-600">背景颜色</div>
                      <div className="mt-2 grid grid-cols-8 gap-2">
                        {BG_COLORS.map((c) => {
                          const active =
                            String(editor.getAttributes('textBackground')?.backgroundColor || '').toLowerCase() === String(c.value || '').toLowerCase()
                          return (
                            <button
                              key={c.label}
                              type="button"
                              className={[
                                'h-8 w-8 rounded-md border',
                                active ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-300',
                              ].join(' ')}
                              title={c.label}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                if (c.value) editor.chain().focus().setTextBackground(c.value).run()
                                else editor.chain().focus().unsetTextBackground().run()
                              }}
                            >
                              {c.value ? (
                                <span className="block h-full w-full rounded-md" style={{ backgroundColor: c.swatch }} />
                              ) : (
                                <span
                                  className="block h-full w-full rounded-md"
                                  style={{
                                    background:
                                      'linear-gradient(135deg, transparent 0%, transparent 45%, #9ca3af 45%, #9ca3af 55%, transparent 55%, transparent 100%)',
                                  }}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

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
            if (f) void uploadImage(f)
          }}
        />

        {editor ? (
          <>
            <BubbleMenu
              editor={editor}
              options={{ placement: 'top', offset: 8 }}
              shouldShow={({ editor, state }) => {
                if (!editor.isEditable) return false
                if (!editor.view.hasFocus()) return false
                if (!state.selection.empty) return true
                return editor.isActive('image')
              }}
            >
              <Toolbar />
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
                <Toolbar />
              </div>
            ) : null}

            <div
              onMouseMove={(e) => {
                if (!editor) return
                updateHoverHandle(e.target as HTMLElement, e.clientX)
              }}
              onMouseLeave={() => {
                if (blockMenuOpen) return
                if (editor.view.hasFocus()) updateSelectionHandle()
                else setBlockHandle(null)
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
