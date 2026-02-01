"use client"

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { BlockLayout } from '@/components/editor/extensions/BlockLayout'
import { TextBackground } from '@/components/editor/extensions/TextBackground'
import { TextColor } from '@/components/editor/extensions/TextColor'
import { FigureImage } from '@/components/editor/extensions/FigureImage'
import { InlineCode } from '@/components/editor/extensions/InlineCode'
import { SeichiRoute } from '@/components/editor/extensions/SeichiRoute'
import { SeichiCallout } from '@/components/editor/extensions/SeichiCallout'
import { useEffect } from 'react'
import type { TipTapNode } from '@/lib/translation/tiptap'

export type TipTapPreviewProps = {
  content: TipTapNode | null
  mode: 'preview' | 'edit'
  onChange?: (content: TipTapNode) => void
  placeholder?: string
}

export default function TipTapPreview({ 
  content, 
  mode, 
  onChange,
  placeholder = '暂无内容' 
}: TipTapPreviewProps) {
  const isEditable = mode === 'edit'

  const editor = useEditor({
    editable: isEditable,
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
        placeholder,
      }),
    ],
    content: content as any, // TipTap content type is loose
    onUpdate({ editor }) {
      onChange?.(editor.getJSON() as TipTapNode)
    },
    editorProps: {
      attributes: {
        class: [
          'prose prose-pink max-w-none focus:outline-none',
          isEditable ? 'min-h-[8rem]' : ''
        ].join(' '),
        'data-seichi-article-content': 'true',
      },
    },
  }, [mode]) // Re-create editor if mode changes, or handle update

  useEffect(() => {
    if (editor && editor.isEditable !== isEditable) {
      editor.setEditable(isEditable)
    }
  }, [editor, isEditable])

  useEffect(() => {
    if (editor && content && JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
       if (!isEditable) {
         editor.commands.setContent(content as any)
       }
    }
  }, [editor, content, isEditable])

  if (!editor) {
    return null
  }

  return (
    <div className={isEditable ? "rounded-md border border-gray-200 bg-white p-4" : ""}>
      <EditorContent editor={editor} />
    </div>
  )
}
