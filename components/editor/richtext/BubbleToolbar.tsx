import type { Editor } from '@tiptap/react'
import type { BlockAlign } from '@/components/editor/extensions/BlockLayout'
import { BG_COLORS, TEXT_COLORS } from './constants'
import { resolveActiveFigureImageFromState } from './utils'

type BubbleToolbarProps = {
  editor: Editor
  linkEditing: boolean
  linkValue: string
  setLinkValue: (value: string) => void
  applyLink: () => void
  unsetLink: () => void
  closeLinkEditor: () => void
  openLinkEditor: () => void
  uploading: boolean
  onPickImage: () => void
  getActiveBlockLabel: () => string
  getActiveAlign: () => BlockAlign
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

export function BubbleToolbar({
  editor,
  linkEditing,
  linkValue,
  setLinkValue,
  applyLink,
  unsetLink,
  closeLinkEditor,
  openLinkEditor,
  uploading,
  onPickImage,
  getActiveBlockLabel,
  getActiveAlign,
}: BubbleToolbarProps) {
  const activeImage = resolveActiveFigureImageFromState(editor.state)

  if (activeImage) {
    const pos = activeImage.pos ?? 0
    const rotate = Number((activeImage.node?.attrs as any)?.rotate ?? 0) || 0
    const flipX = Boolean((activeImage.node?.attrs as any)?.flipX)
    const flipY = Boolean((activeImage.node?.attrs as any)?.flipY)
    const cropEditing = Boolean((activeImage.node?.attrs as any)?.cropEditing)
    const widthPct = (() => {
      const n = Number((activeImage.node?.attrs as any)?.widthPct ?? 100)
      if (!Number.isFinite(n)) return 100
      return Math.max(10, Math.min(100, Math.round(n)))
    })()

    const setWidthPct = (next: number) => {
      const v = Math.max(10, Math.min(100, Math.round(next)))
      const chain = editor.chain().focus().updateAttributes('figureImage', { widthPct: v })
      if (activeImage.pos != null) chain.setNodeSelection(pos)
      chain.run()
    }

    return (
      <div
        data-image-toolbar
        className="flex items-center rounded-xl border border-gray-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur"
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest?.('input, textarea')) return
          e.preventDefault()
        }}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片左对齐"
            onClick={() => editor.chain().focus().setBlockAlign('left').run()}
          >
            左
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片居中对齐"
            onClick={() => editor.chain().focus().setBlockAlign('center').run()}
          >
            中
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片右对齐"
            onClick={() => editor.chain().focus().setBlockAlign('right').run()}
          >
            右
          </button>
        </div>

        <Divider />

        <div className="flex items-center gap-1">
          <span className="px-2 py-1 text-xs tabular-nums text-gray-500" aria-label={`图片宽度 ${widthPct}%`}>
            {widthPct}%
          </span>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="设置图片宽度 50%"
            onClick={() => setWidthPct(50)}
          >
            50%
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="设置图片宽度 100%"
            onClick={() => setWidthPct(100)}
          >
            100%
          </button>
        </div>

        <Divider />

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片裁剪"
            onClick={() => {
              const chain = editor.chain().focus().updateAttributes('figureImage', { cropEditing: !cropEditing })
              if (activeImage.pos != null) chain.setNodeSelection(pos)
              chain.run()
            }}
            title={cropEditing ? '完成裁剪' : '裁剪'}
          >
            {cropEditing ? '完成' : '裁剪'}
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片旋转 90°"
            onClick={() => {
              const next = (rotate + 90) % 360
              const chain = editor.chain().focus().updateAttributes('figureImage', { rotate: next })
              if (activeImage.pos != null) chain.setNodeSelection(pos)
              chain.run()
            }}
          >
            旋转
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片水平翻转"
            onClick={() => {
              const chain = editor.chain().focus().updateAttributes('figureImage', { flipX: !flipX })
              if (activeImage.pos != null) chain.setNodeSelection(pos)
              chain.run()
            }}
          >
            翻转X
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片垂直翻转"
            onClick={() => {
              const chain = editor.chain().focus().updateAttributes('figureImage', { flipY: !flipY })
              if (activeImage.pos != null) chain.setNodeSelection(pos)
              chain.run()
            }}
          >
            翻转Y
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            aria-label="图片图注"
            onClick={() => {
              editor.chain().focus().updateAttributes('figureImage', { caption: true }).setTextSelection(pos + 1).run()
            }}
          >
            图注
          </button>
        </div>
      </div>
    )
  }

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
              if (e.key === 'Escape') closeLinkEditor()
            }}
            autoFocus
          />
          <ToolButton label="保存" onClick={applyLink} />
          <ToolButton label="移除" onClick={unsetLink} />
          <ToolButton label="取消" onClick={closeLinkEditor} />
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
                        editor.chain().focus().toggleOrderedList().run()
                      }}
                    />
                    <BlockDropdownItem
                      icon="•"
                      label="无序列表"
                      active={editor.isActive('bulletList')}
                      onClick={() => {
                        editor.chain().focus().toggleBulletList().run()
                      }}
                    />
                    <BlockDropdownItem
                      icon="</>"
                      label="代码块"
                      active={editor.isActive('codeBlock')}
                      onClick={() => {
                        editor.chain().focus().toggleCodeBlock().run()
                      }}
                    />
                    <BlockDropdownItem
                      icon="❝"
                      label="引用"
                      active={editor.isActive('blockquote')}
                      onClick={() => {
                        editor.chain().focus().toggleBlockquote().run()
                      }}
                    />
                    <div className="my-1 h-px bg-gray-100" />
                    <BlockDropdownItem icon="链" label="链接..." active={editor.isActive('link')} onClick={openLinkEditor} />
                    {editor.isActive('link') ? <BlockDropdownItem icon="链" label="移除链接" onClick={unsetLink} /> : null}
                    <BlockDropdownItem
                      icon="泡"
                      label={editor.isActive('seichiCallout') ? '取消气泡提示' : '气泡提示'}
                      active={editor.isActive('seichiCallout')}
                      onClick={() => {
                        const chain = editor.chain().focus()
                        if (editor.isActive('seichiCallout')) {
                          chain.unsetSeichiCallout().run()
                          return
                        }
                        if (editor.state.selection.empty) {
                          chain.insertSeichiCallout().run()
                          return
                        }
                        chain.wrapInSeichiCallout().run()
                      }}
                    />
                    <BlockDropdownItem icon="路" label="插入路线图/清单..." onClick={() => editor.chain().focus().insertSeichiRoute().run()} />
                    <BlockDropdownItem icon="图" label={uploading ? '上传中...' : '插入图片...'} onClick={onPickImage} />
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
