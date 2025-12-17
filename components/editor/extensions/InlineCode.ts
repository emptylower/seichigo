"use client"

import Code from '@tiptap/extension-code'

// Default inline-code mark in ProseMirror excludes all other marks (excludes: "_"),
// which prevents adding links on code-formatted text.
// This customized version keeps the usual "no mixed formatting" behavior,
// but allows combining `code` with `link`.
export const InlineCode = Code.extend({
  excludes: 'bold italic underline strike textColor textBackground',
})

