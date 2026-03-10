# EDITOR MODULE

## OVERVIEW
`components/editor` implements TipTap-based rich-text editing with custom nodes/extensions and strict sanitization compatibility requirements.

## STRUCTURE
```text
components/editor/
|- RichTextEditor.tsx           # Main editor (612 lines, allowlisted hotspot)
|- richtext/
|  `- BubbleToolbar.tsx          # Bubble menu (560 lines, hotspot)
`- extensions/
   |- SeichiCallout.tsx          # Custom callout node
   |- SeichiRoute.tsx            # Route embed node
   `- FigureImage.tsx            # Figure image node
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main editor behavior | `RichTextEditor.tsx` | 612-line integration surface; line-budget allowlisted |
| Bubble menu | `richtext/BubbleToolbar.tsx` | 560-line formatting toolbar; line-budget allowlisted |
| Custom nodes | `extensions/*` | TipTap extension definitions |
| Sanitization contract | `lib/richtext/sanitize.ts` | Allowed tags/attrs/styles must match editor output |
| Test shims | `tests/setup.ts` | ProseMirror DOM polyfills required in JSDOM |

## CONVENTIONS
- Preserve output compatibility with `sanitizeRichTextHtml` allowlists.
- Keep extension attribute names stable (`data-*`) unless sanitizer is updated in tandem.
- Prefer incremental extension updates over reworking editor core state.
- When adding rendered HTML, ensure links/images obey existing safe URL rules.

## ANTI-PATTERNS
- Do not add extension tags/attrs without sanitizer updates and tests.
- Do not remove TipTap/ProseMirror test shims from `tests/setup.ts`.
- Do not bypass sanitizer assumptions with raw `dangerouslySetInnerHTML` paths.
- Do not couple editor internals to unrelated page-specific state.
